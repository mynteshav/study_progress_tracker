import { IDatabaseAdapter } from './types';
import { SCHEMA_STATEMENTS } from './schema';

const STORAGE_KEY = 'study_tracker_web_db_v1';

interface DbStore {
  tables: Record<string, any[]>;
  autoInc: Record<string, number>;
}

let dbData: DbStore = {
  tables: {},
  autoInc: {}
};

let isInitialized = false;

// Load stored DB from LocalStorage
function loadDb(): DbStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.tables) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[WebAdapter] Failed to load DB from LocalStorage:', e);
  }
  return { tables: {}, autoInc: {} };
}

function saveDb(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dbData));
  } catch (e) {
    console.error('[WebAdapter] Failed to save DB to LocalStorage:', e);
  }
}

function ensureTable(tableName: string): any[] {
  const name = tableName.toLowerCase().trim();
  if (!dbData.tables[name]) {
    dbData.tables[name] = [];
    dbData.autoInc[name] = 1;
  }
  return dbData.tables[name];
}

function getNextId(tableName: string): number {
  const name = tableName.toLowerCase().trim();
  const rows = ensureTable(name);
  let maxId = dbData.autoInc[name] || 0;
  for (const r of rows) {
    if (typeof r.id === 'number' && r.id > maxId) {
      maxId = r.id;
    }
  }
  const next = maxId + 1;
  dbData.autoInc[name] = next;
  return next;
}

/**
 * Replace SQL '?' placeholders with safe literal representations of params.
 * This prevents parameter index state corruption during condition evaluations.
 */
function substituteParams(sqlClause: string, params: any[]): string {
  let paramIdx = 0;
  return sqlClause.replace(/\?/g, () => {
    if (paramIdx >= params.length) return 'NULL';
    const val = params[paramIdx++];
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    const escaped = String(val).replace(/'/g, "''");
    return `'${escaped}'`;
  });
}

// SQL Helper methods for string & date functions in queries
function evaluateExpr(row: any, exprStr: string): any {
  let expr = exprStr.replace(/^\(+/, '').replace(/\)+$/, '').trim();
  if (expr.toLowerCase().startsWith('substr(')) {
    const match = expr.match(/substr\s*\(\s*([a-zA-Z0-9_]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (match) {
      const colVal = String(row[match[1]] || '');
      const start = parseInt(match[2], 10) - 1;
      const len = parseInt(match[3], 10);
      return colVal.substring(start, start + len);
    }
  }
  if (expr.toLowerCase().startsWith('lower(') && expr.toLowerCase().includes('trim(')) {
    const match = expr.match(/lower\s*\(\s*trim\s*\(\s*([a-zA-Z0-9_\.]+)\s*\)\s*\)/i);
    if (match) {
      const field = match[1].includes('.') ? match[1].split('.')[1] : match[1];
      return String(row[field] || '').trim().toLowerCase();
    }
  }
  const fieldName = expr.includes('.') ? expr.split('.')[1] : expr;
  return row[fieldName];
}

function matchesCondition(row: any, condStr: string): boolean {
  let cond = condStr.replace(/^\(+/, '').replace(/\)+$/, '').trim();
  if (!cond) return true;

  if (cond.toUpperCase().includes(' AND ')) {
    const parts = cond.split(/\s+AND\s+/i);
    return parts.every((p) => matchesCondition(row, p));
  }

  if (cond.toUpperCase().includes(' OR ')) {
    const parts = cond.split(/\s+OR\s+/i);
    return parts.some((p) => matchesCondition(row, p));
  }

  if (/\bIS NOT NULL\b/i.test(cond)) {
    const field = cond.replace(/\bIS NOT NULL\b/i, '').trim();
    const val = evaluateExpr(row, field);
    return val !== null && val !== undefined && val !== 'NULL';
  }

  if (/\bIS NULL\b/i.test(cond)) {
    const field = cond.replace(/\bIS NULL\b/i, '').trim();
    const val = evaluateExpr(row, field);
    return val === null || val === undefined || val === 'NULL';
  }

  if (/\bLIKE\b/i.test(cond)) {
    const parts = cond.split(/\bLIKE\b/i);
    const val = String(evaluateExpr(row, parts[0]) || '').toLowerCase();
    let expected = parts[1].trim();
    if (expected.startsWith("'") && expected.endsWith("'")) {
      expected = expected.slice(1, -1);
    }
    expected = expected.replace(/%/g, '').toLowerCase();
    return val.includes(expected);
  }

  const opMatch = cond.match(/([a-zA-Z0-9_\.\(\)\s\',]+)\s*(=|!=|>|<|>=|<=)\s*(.*)/);
  if (opMatch) {
    const leftExpr = opMatch[1].trim();
    const op = opMatch[2].trim();
    let rightExpr = opMatch[3].trim();

    const leftVal = evaluateExpr(row, leftExpr);
    let rightVal: any;

    if (rightExpr.startsWith("'") && rightExpr.endsWith("'")) {
      rightVal = rightExpr.slice(1, -1);
    } else if (rightExpr.toUpperCase() === 'NULL') {
      rightVal = null;
    } else if (!isNaN(Number(rightExpr))) {
      rightVal = Number(rightExpr);
    } else {
      rightVal = evaluateExpr(row, rightExpr);
    }

    const cleanLeft = leftVal !== null && leftVal !== undefined ? String(leftVal) : '';
    const cleanRight = rightVal !== null && rightVal !== undefined ? String(rightVal) : '';

    if (op === '=') return cleanLeft === cleanRight || String(leftVal) == String(rightVal);
    if (op === '!=') return cleanLeft !== cleanRight;
    if (op === '>') return Number(leftVal) > Number(rightVal);
    if (op === '<') return Number(leftVal) < Number(rightVal);
    if (op === '>=') return Number(leftVal) >= Number(rightVal);
    if (op === '<=') return Number(leftVal) <= Number(rightVal);
  }

  return true;
}

export const webAdapter: IDatabaseAdapter = {
  async initDb(): Promise<void> {
    if (isInitialized) return;
    dbData = loadDb();

    for (const stmt of SCHEMA_STATEMENTS) {
      const match = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        ensureTable(tableName);
      }
    }

    saveDb();
    isInitialized = true;
    console.log('[WebAdapter] In-memory LocalStorage DB initialized.');
  },

  async query(sql: string, params: any[] = []): Promise<any[]> {
    if (!isInitialized && webAdapter.initDb) await webAdapter.initDb();
    const trimmed = sql.trim();

    const selectMatch = trimmed.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([a-zA-Z0-9_]+)/i);
    if (selectMatch) {
      const selectColsStr = selectMatch[1].trim();
      const tableName = selectMatch[2].toLowerCase().trim();
      let rows = [...ensureTable(tableName)];

      const joinMatch = trimmed.match(/JOIN\s+([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)?\s+ON\s+([^\s]+)\s*=\s*([^\s]+)/i);
      if (joinMatch) {
        const joinTable = joinMatch[1].toLowerCase();
        const joinAlias = joinMatch[2] || joinTable;
        const leftOn = joinMatch[3];
        const rightOn = joinMatch[4];
        const joinRows = ensureTable(joinTable);

        const joined: any[] = [];
        for (const r of rows) {
          for (const jr of joinRows) {
            const leftVal = leftOn.includes('.') ? (leftOn.startsWith(joinAlias) ? jr[leftOn.split('.')[1]] : r[leftOn.split('.')[1]]) : r[leftOn];
            const rightVal = rightOn.includes('.') ? (rightOn.startsWith(joinAlias) ? jr[rightOn.split('.')[1]] : r[rightOn.split('.')[1]]) : r[rightOn];
            if (leftVal == rightVal) {
              joined.push({ ...r, ...jr });
            }
          }
        }
        rows = joined;
      }

      const whereMatch = trimmed.match(/WHERE\s+([\s\S]+?)(?=\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i);
      if (whereMatch) {
        const whereClause = whereMatch[1].trim();
        const substitutedWhere = substituteParams(whereClause, params);
        rows = rows.filter((row) => matchesCondition(row, substitutedWhere));
      }

      if (selectColsStr.toUpperCase().includes('COUNT(') || selectColsStr.toUpperCase().includes('SUM(') || selectColsStr.toUpperCase().includes('MAX(') || selectColsStr.toUpperCase().includes('AVG(')) {
        if (!trimmed.toUpperCase().includes('GROUP BY')) {
          const resRow: any = {};
          const aggMatches = selectColsStr.split(',');
          for (const item of aggMatches) {
            const aliasMatch = item.match(/(COUNT|SUM|MAX|AVG)\s*\(\s*([\s\S]+?)\s*\)(?:\s+as\s+([a-zA-Z0-9_]+))?/i);
            if (aliasMatch) {
              const fn = aliasMatch[1].toUpperCase();
              const expr = aliasMatch[2].trim();
              const alias = aliasMatch[3] || (fn.toLowerCase() + '_val');

              if (fn === 'COUNT') {
                resRow[alias] = rows.length;
              } else if (fn === 'MAX') {
                const vals = rows.map((r) => Number(r[expr]) || 0);
                resRow[alias] = vals.length > 0 ? Math.max(...vals) : 0;
              } else if (fn === 'SUM') {
                if (expr.toUpperCase().startsWith('CASE')) {
                  let sum = 0;
                  for (const r of rows) {
                    if (expr.includes("status = 'done'") && r.status === 'done') sum += 1;
                    else if (expr.includes('saved_time > 0') && r.saved_time > 0) sum += (r.saved_time || 0);
                  }
                  resRow[alias] = sum;
                } else {
                  const sum = rows.reduce((acc, r) => acc + (Number(r[expr]) || 0), 0);
                  resRow[alias] = sum;
                }
              } else if (fn === 'AVG') {
                const sum = rows.reduce((acc, r) => acc + (Number(r[expr]) || 0), 0);
                resRow[alias] = rows.length > 0 ? Math.round(sum / rows.length) : 0;
              }
            }
          }
          return [resRow];
        }
      }

      const orderMatch = trimmed.match(/ORDER\s+BY\s+([\s\S]+?)(?=\s+LIMIT|$)/i);
      if (orderMatch) {
        const orderCols = orderMatch[1].split(',').map((s) => s.trim());
        rows.sort((a, b) => {
          for (const colDef of orderCols) {
            const parts = colDef.split(/\s+/);
            const col = parts[0].includes('.') ? parts[0].split('.')[1] : parts[0];
            const dir = parts[1] && parts[1].toUpperCase() === 'DESC' ? -1 : 1;
            const valA = a[col];
            const valB = b[col];
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
          }
          return 0;
        });
      }

      const limitMatch = trimmed.match(/LIMIT\s+(\d+)/i);
      if (limitMatch) {
        const limit = parseInt(limitMatch[1], 10);
        rows = rows.slice(0, limit);
      }

      return rows;
    }

    return [];
  },

  async run(sql: string, params: any[] = []): Promise<{ id: number; changes: number }> {
    if (!isInitialized && webAdapter.initDb) await webAdapter.initDb();
    const trimmed = sql.trim();

    if (/^(CREATE|PRAGMA|ALTER|DROP)/i.test(trimmed)) {
      const match = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
      if (match) {
        ensureTable(match[1].toLowerCase());
        saveDb();
      }
      return { id: 0, changes: 0 };
    }

    const insertMatch = trimmed.match(/^INSERT\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const tableName = insertMatch[1].toLowerCase().trim();
      const cols = insertMatch[2].split(',').map((c) => c.trim());
      const rows = ensureTable(tableName);

      const newRow: any = {};
      let paramIdx = 0;

      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        if (paramIdx < params.length) {
          newRow[col] = params[paramIdx++];
        } else {
          newRow[col] = null;
        }
      }

      if (!newRow.id) {
        newRow.id = getNextId(tableName);
      }

      if (!newRow.created_at) {
        newRow.created_at = new Date().toISOString();
      }

      if (trimmed.toUpperCase().includes('ON CONFLICT')) {
        const conflictMatch = trimmed.match(/ON\s+CONFLICT\s*\(([^)]+)\)\s*DO\s+UPDATE\s+SET\s+(.+)/i);
        if (conflictMatch) {
          const conflictCols = conflictMatch[1].split(',').map((c) => c.trim().toLowerCase());
          const existingIdx = rows.findIndex((r) => conflictCols.every((col) => r[col] == newRow[col]));
          if (existingIdx !== -1) {
            rows[existingIdx] = { ...rows[existingIdx], ...newRow };
            saveDb();
            return { id: rows[existingIdx].id || 0, changes: 1 };
          }
        }
      }

      rows.push(newRow);
      saveDb();
      return { id: newRow.id, changes: 1 };
    }

    const updateMatch = trimmed.match(/^UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (updateMatch) {
      const tableName = updateMatch[1].toLowerCase().trim();
      const setClause = updateMatch[2].trim();
      const whereClause = updateMatch[3] ? updateMatch[3].trim() : '';

      const rows = ensureTable(tableName);
      let updatedCount = 0;

      const setItems = setClause.split(',').map((s) => s.trim());
      const numSetParams = (setClause.match(/\?/g) || []).length;
      const setParams = params.slice(0, numSetParams);
      const whereParams = params.slice(numSetParams);

      const substitutedWhere = whereClause ? substituteParams(whereClause, whereParams) : '';

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const matches = whereClause ? matchesCondition(row, substitutedWhere) : true;

        if (matches) {
          let itemParamIdx = 0;
          for (const item of setItems) {
            const kv = item.match(/([a-zA-Z0-9_]+)\s*=\s*(.+)/);
            if (kv) {
              const col = kv[1].trim();
              const expr = kv[2].trim();

              if (expr === '?') {
                row[col] = setParams[itemParamIdx++];
              } else if (expr.includes('+')) {
                const addMatch = expr.match(/([a-zA-Z0-9_]+)\s*\+\s*\?/);
                if (addMatch) {
                  row[col] = (Number(row[col]) || 0) + (Number(setParams[itemParamIdx++]) || 0);
                }
              } else if (expr.includes('-')) {
                const subMatch = expr.match(/([a-zA-Z0-9_]+)\s*-\s*\?/);
                if (subMatch) {
                  row[col] = (Number(row[col]) || 0) - (Number(setParams[itemParamIdx++]) || 0);
                }
              } else if (expr === 'CURRENT_TIMESTAMP') {
                row[col] = new Date().toISOString();
              } else if (expr.startsWith("'") && expr.endsWith("'")) {
                row[col] = expr.slice(1, -1);
              } else if (!isNaN(Number(expr))) {
                row[col] = Number(expr);
              }
            }
          }
          updatedCount++;
        }
      }

      saveDb();
      return { id: 0, changes: updatedCount };
    }

    const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (deleteMatch) {
      const tableName = deleteMatch[1].toLowerCase().trim();
      const whereClause = deleteMatch[2] ? deleteMatch[2].trim() : '';

      let rows = ensureTable(tableName);
      const initialLen = rows.length;

      if (!whereClause) {
        dbData.tables[tableName] = [];
      } else {
        const substitutedWhere = substituteParams(whereClause, params);
        dbData.tables[tableName] = rows.filter((row) => !matchesCondition(row, substitutedWhere));
      }

      saveDb();
      return { id: 0, changes: initialLen - dbData.tables[tableName].length };
    }

    return { id: 0, changes: 0 };
  },

  async get(sql: string, params: any[] = []): Promise<any> {
    const rows = await this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }
};
