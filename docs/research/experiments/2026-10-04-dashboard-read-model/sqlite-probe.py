"""Synthetic SQLite semantics/query-plan probe; not a D1 benchmark."""
import sqlite3
import unicodedata
import json


def normalize(value):
    # A candidate policy for Latin accented text; not full Unicode case-folding.
    return ''.join(character for character in unicodedata.normalize('NFD', value).lower()
                   if not unicodedata.category(character).startswith('M'))


connection = sqlite3.connect(':memory:')
connection.executescript('''
CREATE TABLE reviews (
  repo_id INTEGER NOT NULL,
  pr_no INTEGER NOT NULL,
  state TEXT NOT NULL,
  activity INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_search TEXT NOT NULL,
  snapshot_revision INTEGER NOT NULL,
  PRIMARY KEY(repo_id, pr_no)
);
CREATE INDEX review_activity ON reviews(repo_id, activity DESC, pr_no DESC);
CREATE INDEX review_state_activity ON reviews(repo_id, state, activity DESC, pr_no DESC);
''')
rows = []
for repo in (1, 2):
    for number in range(1, 10001):
        title = f'Alteração sintética {number}'
        if number in (7, 777, 9007):
            title = f'Revisão CAFÉ e AUTENTICAÇÃO {number}'
        if number == 9999:
            title = 'Texto literal 100%_pronto ' + 'a' * 80
        rows.append((repo, number, 'completed' if number % 2 else 'running', number,
                     title, normalize(title), 1))
connection.executemany('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)', rows)
queries = {
    'list': ('SELECT pr_no FROM reviews WHERE repo_id=? ORDER BY activity DESC,pr_no DESC LIMIT 50', (1,)),
    'state': ('SELECT pr_no FROM reviews WHERE repo_id=? AND state=? ORDER BY activity DESC,pr_no DESC LIMIT 50', (1, 'completed')),
    'number': ('SELECT pr_no FROM reviews WHERE repo_id=? AND pr_no=?', (1, 777)),
    'contains': ('SELECT pr_no FROM reviews WHERE repo_id=? AND instr(title_search,?)>0 ORDER BY activity DESC,pr_no DESC LIMIT 50', (1, normalize('FÉ'))),
}
report = {
    'sqlite_version': sqlite3.sqlite_version,
    'synthetic_rows': len(rows),
    'normalization_policy': 'NFD + Unicode lower + remove Unicode categories M; candidate, not full Unicode case-folding',
    'queries': {name: {'sql': sql, 'parameters': parameters} for name, (sql, parameters) in queries.items()},
    'plans': {name: connection.execute('EXPLAIN QUERY PLAN ' + sql, parameters).fetchall()
              for name, (sql, parameters) in queries.items()},
    'first_results': {name: connection.execute(sql, parameters).fetchall()[:5]
                      for name, (sql, parameters) in queries.items()},
    'literal_percent_underscore': connection.execute('SELECT pr_no FROM reviews WHERE repo_id=? AND instr(title_search,?)>0', (1, normalize('100%_'))).fetchall(),
    'long_term_80_characters': connection.execute('SELECT pr_no FROM reviews WHERE repo_id=? AND instr(title_search,?)>0', (1, 'a' * 80)).fetchall(),
    'sqlite_builtin_case_behavior': connection.execute("SELECT 'CAFÉ' LIKE 'café', 'CAFÉ' LIKE 'cafe', lower('CAFÉ')").fetchone(),
    'normalization_examples': {value: normalize(value) for value in ('CAFÉ', 'café', 'Cafe\u0301', 'AUTENTICAÇÃO', 'autenticacao', '100%_', 'ẞ', 'SS', 'ß', 'İ', 'i', 'ı')},
    'warning': 'No remote D1 query; no D1 latency, rows_read, workload, crash recovery, or complete Unicode semantics proven.'
}
connection.execute("INSERT INTO reviews VALUES(3,1,'completed',1,'a','a',4)")
upsert = '''INSERT INTO reviews VALUES(?,?,?,?,?,?,?)
ON CONFLICT(repo_id,pr_no) DO UPDATE SET state=excluded.state,activity=excluded.activity,
title=excluded.title,title_search=excluded.title_search,snapshot_revision=excluded.snapshot_revision
WHERE excluded.snapshot_revision>reviews.snapshot_revision'''
for revision, title in ((3, 'old'), (4, 'duplicate'), (6, 'fresh'), (5, 'reordered')):
    connection.execute(upsert, (3, 1, 'running', revision, title, title, revision))
report['monotonic_upsert_sql'] = upsert
report['monotonic_upsert_result'] = connection.execute('SELECT title,snapshot_revision FROM reviews WHERE repo_id=3').fetchone()
assert report['first_results']['contains'] == [(9007,), (777,), (7,)]
assert report['literal_percent_underscore'] == [(9999,)]
assert report['long_term_80_characters'] == [(9999,)]
assert report['monotonic_upsert_result'] == ('fresh', 6)
assert normalize('CAFÉ') == normalize('Cafe\u0301') == normalize('café') == 'cafe'
print(json.dumps(report, ensure_ascii=False, indent=2))
