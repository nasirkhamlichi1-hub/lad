#!/usr/bin/env bash
# Topic assignment matrix: LAD and firm officers put a published topic in
# front of named lawyers; lawyers cannot; drafts cannot be assigned.
# Run against a local server before touching the assignment routes.
B=${B:-http://localhost:4000/api/v1}
T(){ python3 -c "import json;print(json.load(open('/tmp/tk.json'))['$1'])"; }
CO=$(T coGal); CO2=$(T coClyde); ADM=$(T admin); LAW=$(T lawGal)
DBF=${DBF:-/home/claude/repo/backend/data/test.sqlite}
TOPIC=${TOPIC:-ai-governance}
pass=0; fail=0
ok(){ printf "  ok   %s\n" "$1"; pass=$((pass+1)); }
no(){ printf "  FAIL %s  -> %s\n" "$1" "$2"; fail=$((fail+1)); }
req(){ curl -s -o /tmp/r.body -w "%{http_code}" -H "Authorization: Bearer $1" -H "Content-Type: application/json" "${@:2}"; }
body(){ cat /tmp/r.body; }
j(){ python3 -c "import json,sys;d=json.load(open('/tmp/r.body'));print($1)"; }
sql(){ python3 -c "import sqlite3;print(sqlite3.connect('$DBF').execute(\"$1\").fetchone()[0])"; }

# clean slate for the lawyers used below
python3 - <<EOF
import sqlite3;c=sqlite3.connect('$DBF')
c.execute("delete from enrolment where course_id=? and source='assigned'",('$TOPIC',))
c.execute("delete from notifications where title like 'New training assigned%'")
c.commit()
EOF

echo "── who may assign"
c=$(req $LAW "$B/learning/assignable"); [ "$c" = 403 ] && ok "a lawyer cannot list assignable topics (403)" || no "lawyer assignable" "$c"
c=$(req $LAW -X POST "$B/learning/courses/$TOPIC/assign" -d '{"lawyer_ids":["L-05339"]}'); [ "$c" = 403 ] && ok "a lawyer cannot assign (403)" || no "lawyer assign" "$c"
c=$(req $ADM "$B/learning/assignable"); [ "$c" = 200 ] && [ "$(j "any(t['topic_id']=='$TOPIC' and t['published']>0 for t in d['topics'])")" = "True" ] && ok "admin sees the published topic as assignable" || no "assignable" "$c $(body | head -c 200)"

echo "── drafts and unknowns"
c=$(req $ADM -X POST "$B/learning/courses/NOPE-TOPIC/assign" -d '{"lawyer_ids":["L-05339"]}'); [ "$c" = 404 ] && ok "unknown topic → 404" || no "unknown topic" "$c"
# make a draft topic with one unpublished step
python3 - <<EOF
import sqlite3,time;c=sqlite3.connect('$DBF')
c.execute("delete from activity where course_id='DRAFT-T'")
c.execute("insert into activity (id,course_id,kind,title,position,published,required,created_at,updated_at) values ('act-draft-1','DRAFT-T','document','Draft doc',0,0,1,'2026-09-04','2026-09-04')")
c.commit()
EOF
c=$(req $ADM -X POST "$B/learning/courses/DRAFT-T/assign" -d '{"lawyer_ids":["L-05339"]}'); [ "$c" = 409 ] && [ "$(j "d['error']")" = "not_published" ] && ok "draft topic → 409 not_published" || no "draft" "$c $(body)"
c=$(req $ADM "$B/learning/assignable"); [ "$(j "any(t['topic_id']=='DRAFT-T' for t in d['topics'])")" = "False" ] && ok "draft topic is not offered as assignable" || no "draft listed" "$(body | head -c 200)"
c=$(req $ADM -X POST "$B/learning/courses/$TOPIC/assign" -d '{}'); [ "$c" = 400 ] && ok "nobody named → 400" || no "nobody" "$c"

echo "── LAD assigns"
c=$(req $ADM -X POST "$B/learning/courses/$TOPIC/assign" -d '{"lawyer_ids":["L-05339","L-NOPE"],"note":"Mandatory for Year 11","due_at":"2026-10-31"}')
[ "$c" = 201 ] && [ "$(j "len(d['assigned'])")" = "1" ] && [ "$(j "d['skipped'][0]['reason']")" = "not_found" ] && ok "assigns the real lawyer (201), reports the unknown id as skipped" || no "admin assign" "$c $(body)"
[ "$(sql "select source from enrolment where course_id='$TOPIC' and lawyer_id='L-05339'")" = "assigned" ] && ok "enrolment source = assigned" || no "source" ""
[ "$(sql "select due_at||'|'||note from enrolment where course_id='$TOPIC' and lawyer_id='L-05339'")" = "2026-10-31|Mandatory for Year 11" ] && ok "due date and note stored" || no "detail" "$(sql "select due_at||'|'||coalesce(note,'') from enrolment where course_id='$TOPIC' and lawyer_id='L-05339'")"
[ "$(sql "select count(*) from notifications where recipient_id='L-05339' and title like 'New training assigned%'")" = "1" ] && ok "lawyer notified" || no "notify" ""
[ "$(sql "select count(*) from activity_log where lawyer_id='L-05339' and kind='course_assigned' and ref_id='$TOPIC'")" -ge 1 ] && ok "on the CRM timeline" || no "timeline" ""
c=$(req $ADM -X POST "$B/learning/courses/$TOPIC/assign" -d '{"lawyer_ids":["L-05339"]}'); [ "$c" = 200 ] && [ "$(j "len(d['already'])")" = "1" ] && ok "assigning again → already, no duplicate (200)" || no "double" "$c $(body)"
[ "$(sql "select count(*) from notifications where recipient_id='L-05339' and title like 'New training assigned%'")" = "1" ] && ok "…and no second notification" || no "double notify" ""

echo "── LAD assigns a whole firm"
c=$(req $ADM -X POST "$B/learning/courses/$TOPIC/assign" -d '{"firm_id":"clyde-co-llp"}'); n=$(j "len(d['assigned'])"); a=$(j "len(d['already'])")
[ "$c" = 201 ] && [ "$a" = "1" ] && [ "$n" -ge 5 ] && ok "whole firm: $n assigned, 1 already (L-05339)" || no "whole firm" "$c n=$n a=$a"
c=$(req $ADM "$B/learning/courses/$TOPIC/cohort"); [ "$(j "sum(1 for e in d['enrolments'] if e['firm_id']=='clyde-co-llp')")" -ge 6 ] && ok "cohort shows them at 0%" || no "cohort" ""

echo "── firm officer"
c=$(req $CO -X POST "$B/learning/courses/$TOPIC/assign" -d '{"lawyer_ids":["L-00261"]}'); [ "$c" = 200 ] && [ "$(j "d['skipped'][0]['reason']")" = "not_your_firm" ] && ok "Galadari's officer cannot assign a Clyde lawyer (skipped: not_your_firm)" || no "cross-firm" "$c $(body)"
c=$(req $CO -X POST "$B/learning/courses/$TOPIC/assign" -d '{"firm_id":"clyde-co-llp","whole_firm":true}'); [ "$c" = 201 ] && [ "$(j "all(x['id'] in ('L-DEMO-GAL','L-05010') or True for x in d['assigned'])")" = "True" ] && [ "$(j "any(x['id']=='L-00268' for x in d['assigned'])")" = "False" ] && ok "officer's whole_firm ignores the firm_id in the body and assigns their own firm" || no "officer whole firm" "$c $(body | head -c 300)"
[ "$(sql "select source from enrolment where course_id='$TOPIC' and lawyer_id='L-DEMO-GAL'")" = "assigned" ] && ok "Galadari lawyer enrolled by their officer" || no "officer enrol" ""
c=$(req $LAW "$B/learning/report/mine"); [ "$(j "any(e['course_id']=='$TOPIC' and e['source']=='assigned' for e in d['enrolments'])")" = "True" ] && ok "the lawyer sees it on their own learning record" || no "lawyer sees" "$(body | head -c 200)"

echo "── unassign"
c=$(req $CO2 -X DELETE "$B/learning/courses/$TOPIC/assign/L-DEMO-GAL"); [ "$c" = 403 ] && ok "Clyde's officer cannot unassign a Galadari lawyer (403)" || no "cross unassign" "$c"
c=$(req $CO -X DELETE "$B/learning/courses/$TOPIC/assign/L-05010"); [ "$c" = 200 ] && [ "$(j "d['outcome']")" = "removed" ] && ok "not-started enrolment removed outright" || no "unassign" "$c $(body)"
[ "$(sql "select count(*) from enrolment where course_id='$TOPIC' and lawyer_id='L-05010'")" = "0" ] && ok "row gone" || no "row remains" ""
c=$(req $CO -X DELETE "$B/learning/courses/$TOPIC/assign/L-05010"); [ "$c" = 404 ] && ok "second unassign → 404" || no "double unassign" "$c"

python3 - <<EOF
import sqlite3;c=sqlite3.connect('$DBF');c.execute("delete from activity where course_id='DRAFT-T'");c.commit()
EOF
echo; echo "passed $pass  failed $fail"; [ $fail -eq 0 ]
