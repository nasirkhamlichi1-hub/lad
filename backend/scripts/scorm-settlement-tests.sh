#!/usr/bin/env bash
# SCORM settlement: the package's own verdict completes the step the moment it is
# saved, whatever the page around the player does. Needs a real (tiny) SCORM zip
# on M-SCORM-T1/T2 in the test DB. Run against a local server.
B=http://localhost:4000/api/v1
T(){ python3 -c "import json;print(json.load(open('/tmp/tk.json'))['$1'])"; }; L=$(T lawGal); A=$(T admin)
DBF=/home/claude/repo/backend/data/test.sqlite
pass=0; fail=0; ok(){ printf "  ok   %s\n" "$1"; pass=$((pass+1)); }; no(){ printf "  FAIL %s -> %s\n" "$1" "$2"; fail=$((fail+1)); }
req(){ curl -s -o /tmp/r.body -w "%{http_code}" -H "Authorization: Bearer $1" -H "Content-Type: application/json" "${@:2}"; }
j(){ python3 -c "import json,sys;d=json.load(open('/tmp/r.body'));print($1)"; }
# reset learner state on ACT-SC-2 / M-SCORM-T2
python3 - <<PY
import sqlite3;c=sqlite3.connect('$DBF')
c.execute("delete from activity_attempt where activity_id='ACT-SC-2' and lawyer_id='L-DEMO-GAL'")
c.execute("delete from activity_progress where activity_id='ACT-SC-2' and lawyer_id='L-DEMO-GAL'")
c.execute("delete from scorm_state where material_id='M-SCORM-T2' and lawyer_id='L-DEMO-GAL'")
c.commit()
PY
echo "── A: hub opens attempt, package commits completed+score, hub closes as abandoned"
c=$(req $L -X POST $B/learning/activities/ACT-SC-2/attempts -d '{}'); ATT=$(j "d['attempt']['id'] if 'attempt' in d else d['id']")
c=$(req $L -X POST $B/scorm/ai-governance/M-SCORM-T2/launch -d '{}'); [ "$c" = 200 ] && ok "launch (enrolled lawyer) 200" || no "launch" "$c $(cat /tmp/r.body)"
PU=$(j "d['player_url']"); TOK=$(echo "$PU" | sed 's#/api/v1/scorm/play/##; s#/__player##')
c=$(curl -s -o /tmp/r.body -w "%{http_code}" -X POST -H "Content-Type: application/json" "$B/scorm/play/$TOK/__state" -d '{"cmi":{"cmi.core.lesson_status":"passed","cmi.core.score.raw":"90"}}')
[ "$c" = 200 ] && [ "$(j "d.get('settled')")" = "1" ] && ok "state save settled the open attempt at commit time" || no "settle at commit" "$c $(cat /tmp/r.body)"
c=$(req $L "$B/learning/courses/ai-governance/outline"); st=$(j "[a for s in d['sections'] for a in s['activities'] if a['id']=='ACT-SC-2'][0]['progress']")
[ "$(j "[a for s in d['sections'] for a in s['activities'] if a['id']=='ACT-SC-2'][0]['progress']['status']")" = "passed" ] && ok "outline shows passed (90 ≥ 80) before the hub even closes" || no "outline" "$st"
c=$(req $L -X POST $B/learning/attempts/$ATT/close -d '{"abandoned":true,"seconds":40}'); [ "$c" = 200 ] && ok "hub's later abandoned close is a no-op (200)" || no "close" "$c $(cat /tmp/r.body)"
c=$(req $L "$B/learning/courses/ai-governance/outline"); [ "$(j "[a for s in d['sections'] for a in s['activities'] if a['id']=='ACT-SC-2'][0]['progress']['status']")" = "passed" ] && ok "still passed after the abandoned close" || no "regressed" ""
echo "── B: no open attempt (opened from the library) — completion still lands"
python3 - <<PY
import sqlite3;c=sqlite3.connect('$DBF')
c.execute("delete from activity_attempt where activity_id='ACT-SC-2' and lawyer_id='L-DEMO-GAL'")
c.execute("delete from activity_progress where activity_id='ACT-SC-2' and lawyer_id='L-DEMO-GAL'")
c.execute("delete from scorm_state where material_id='M-SCORM-T2' and lawyer_id='L-DEMO-GAL'"); c.commit()
PY
c=$(curl -s -o /tmp/r.body -w "%{http_code}" -X POST -H "Content-Type: application/json" "$B/scorm/play/$TOK/__state" -d '{"cmi":{"cmi.core.lesson_status":"incomplete","cmi.core.lesson_location":"3"}}')
[ "$(j "d.get('settled')")" = "0" ] && ok "incomplete commit settles nothing" || no "incomplete" "$(cat /tmp/r.body)"
c=$(curl -s -o /tmp/r.body -w "%{http_code}" -X POST -H "Content-Type: application/json" "$B/scorm/play/$TOK/__state" -d '{"cmi":{"cmi.core.lesson_status":"completed"}}')
[ "$(j "d.get('settled')")" = "1" ] && ok "completed commit with no open attempt writes and closes one" || no "library completion" "$(cat /tmp/r.body)"
c=$(req $L "$B/learning/courses/ai-governance/outline"); [ "$(j "[a for s in d['sections'] for a in s['activities'] if a['id']=='ACT-SC-2'][0]['progress']['status']")" = "completed" ] && ok "outline shows completed" || no "outline B" ""
c=$(curl -s -o /tmp/r.body -w "%{http_code}" -X POST -H "Content-Type: application/json" "$B/scorm/play/$TOK/__state" -d '{"cmi":{"cmi.core.lesson_status":"completed"}}')
[ "$(j "d.get('settled')")" = "0" ] && ok "a second completed commit does not add another attempt" || no "dup" "$(cat /tmp/r.body)"
echo "── C: diagnostics + topic materials access"
c=$(req $A "$B/learning/learners/L-DEMO-GAL/scorm/M-SCORM-T2"); [ "$c" = 200 ] && [ "$(j "d['lesson_status']")" = "completed" ] && ok "admin can read what the package recorded" || no "diag" "$c $(cat /tmp/r.body)"
c=$(req $L "$B/learning/learners/L-DEMO-GAL/scorm/M-SCORM-T2"); [ "$c" = 403 ] && ok "lawyer cannot (403)" || no "diag lawyer" "$c"
python3 - <<PY
import sqlite3;c=sqlite3.connect('$DBF')
c.execute("delete from activity where course_id='TOPIC-NOROW'"); c.execute("delete from enrolment where course_id='TOPIC-NOROW'")
c.execute("insert into activity (id,course_id,kind,title,position,published,required,created_at,updated_at) values ('act-norow','TOPIC-NOROW','document','Doc',0,1,1,'2026-09-04','2026-09-04')")
c.execute("insert into enrolment (id,course_id,lawyer_id,source,status,created_at) values ('enr-norow','TOPIC-NOROW','L-DEMO-GAL','assigned','active','2026-09-04')"); c.commit()
PY
c=$(req $L "$B/courses/TOPIC-NOROW/materials"); [ "$c" = 200 ] && ok "enrolled lawyer can list materials of a topic with no catalogue row (was 403)" || no "topic materials" "$c $(cat /tmp/r.body)"
c=$(req $(T coClyde) "$B/courses/TOPIC-NOROW/materials"); [ "$c" = 200 ] && ok "firm officer can too" || no "officer" "$c"
python3 - <<PY
import sqlite3;c=sqlite3.connect('$DBF');c.execute("delete from activity where course_id='TOPIC-NOROW'");c.execute("delete from enrolment where course_id='TOPIC-NOROW'");c.commit()
PY
echo; echo "passed $pass failed $fail"
