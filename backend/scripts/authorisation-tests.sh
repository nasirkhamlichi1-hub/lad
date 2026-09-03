B=http://localhost:4000/api/v1
COA=$(python3 -c "import json;print(json.load(open('/tmp/two.json'))['coA'])")
COB=$(python3 -c "import json;print(json.load(open('/tmp/two.json'))['coB'])")
LAWA=$(python3 -c "import json;print(json.load(open('/tmp/two.json'))['lawA'])")
PROV=$(python3 -c "import json;print(json.load(open('/tmp/two.json'))['prov'])")
pass=0; fail=0
ok(){ echo "  PASS  $1"; pass=$((pass+1)); }
no(){ echo "  FAIL  $1"; fail=$((fail+1)); }
# has(token, path, needle) -> does the response contain the needle?
has(){ curl -s "$B$2" -H "Authorization: Bearer $1" | grep -qi -- "$3"; }

echo "─── CREDITS: who can move them ─────────────────────────────────────"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/assign -H "Authorization: Bearer $COA" -H 'Content-Type: application/json' -d '{"lawyerId":"L-TESTA","credits":5000}')
[ "$c" = "402" ] && ok "officer cannot assign beyond the firm pool ($c)" || no "officer assigned beyond the pool ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/assign -H "Authorization: Bearer $COA" -H 'Content-Type: application/json' -d '{"lawyerId":"L-TESTB","credits":10}')
[ "$c" = "403" ] && ok "officer cannot assign to another firm's lawyer ($c)" || no "cross-firm assign allowed ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/assign -H "Authorization: Bearer $LAWA" -H 'Content-Type: application/json' -d '{"lawyerId":"L-TESTA","credits":10}')
[ "$c" = "403" ] && ok "a lawyer cannot assign credits at all ($c)" || no "lawyer assigned credits ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/assign -H "Authorization: Bearer $PROV" -H 'Content-Type: application/json' -d '{"lawyerId":"L-TESTA","credits":10}')
[ "$c" = "403" ] && ok "a provider cannot assign credits ($c)" || no "provider assigned credits ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/topup -H "Authorization: Bearer $COA" -H 'Content-Type: application/json' -d '{"email":"a.lawyer@alpha.test","credits":500}')
[ "$c" = "403" ] && ok "officer cannot top up (that is money in) ($c)" || no "officer topped up ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/assign -H "Authorization: Bearer $COA" -H 'Content-Type: application/json' -d '{"lawyerId":"L-TESTA","credits":20}')
[ "$c" = "200" ] && ok "officer CAN assign within the pool ($c)" || no "legitimate assign refused ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/assign -H "Authorization: Bearer $COA" -H 'Content-Type: application/json' -d '{"lawyerId":"L-TESTA","credits":-9999}')
[ "$c" = "402" ] && ok "officer cannot claw back more than the lawyer holds ($c)" || no "over-claw allowed ($c)"

c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/credits/assign -H "Authorization: Bearer $COA" -H 'Content-Type: application/json' -d '{"lawyerId":"L-TESTA","credits":100000}')
[ "$c" = "400" ] && ok "a single assignment is capped ($c)" || no "no cap on assignment size ($c)"

echo "─── POINTS: who can award them ─────────────────────────────────────"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/accreditations -H "Authorization: Bearer $PROV" -H 'Content-Type: application/json' -d '{"type":"session_submission","accreditationCode":"ALP2601","lawyers":[{"id":"L-TESTA"}]}')
[ "$c" = "403" ] && ok "provider cannot file against another org's accreditation ($c)" || no "provider filed against Alpha's code ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/accreditations -H "Authorization: Bearer $COB" -H 'Content-Type: application/json' -d '{"type":"session_submission","accreditationCode":"ALP2601","lawyers":[{"id":"L-TESTA"}]}')
[ "$c" = "403" ] && ok "firm B cannot file against firm A's accreditation ($c)" || no "cross-firm points filing allowed ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/accreditations/ALP2601/attendees -H "Authorization: Bearer $COB" -H 'Content-Type: application/json' -d '{"attendees":[{"id":"L-TESTB"}]}')
[ "$c" = "403" ] || [ "$c" = "404" ] && ok "firm B cannot record attendees on firm A's code ($c)" || no "cross-firm attendance allowed ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' -X POST $B/accreditations -H 'Content-Type: application/json' -d '{"type":"session_submission","accreditationCode":"ALP2601","lawyers":[{"id":"L-TESTA"}]}')
[ "$c" = "401" ] && ok "anonymous cannot award points ($c)" || no "anonymous award allowed ($c)"

echo "─── FIRM-INTERNAL COURSES: can firms see each other's? ─────────────"
has "$COB" "/courses" "Alpha internal" && no "firm B sees firm A's private course in /courses" || ok "firm B cannot see firm A's private course"
has "$COB" "/courses/upcoming" "Alpha internal" && no "firm B sees it in /courses/upcoming" || ok "not in /courses/upcoming for firm B"
curl -s "$B/config" | grep -qi "Alpha internal" && no "firm A's private course is in the PUBLIC /config" || ok "private course absent from public /config"
curl -s "$B/courses" | grep -qiE "Alpha internal|Beta internal" && no "private courses visible anonymously" || ok "private courses absent for anonymous callers"
has "$COA" "/courses" "Alpha internal" && ok "firm A CAN see its own private course" || no "firm A cannot see its own course"
c=$(curl -s -o /tmp/b -w '%{http_code}' "$B/courses/c-alpha-secret" -H "Authorization: Bearer $COB"); [ "$c" = "404" ] && ok "direct fetch of firm A's course by firm B is 404 ($c)" || no "firm B fetched firm A's course ($c)"
has "$COB" "/accreditations?status=all&limit=200" "Alpha internal" && no "firm B sees firm A's internal accreditation" || ok "firm B cannot see firm A's internal accreditation"
curl -s "$B/accreditations/_/catalog" | grep -qi "Alpha internal" && no "firm-internal course leaks into the public catalogue" || ok "firm-internal course absent from the public catalogue"
c=$(curl -s -o /tmp/b -w '%{http_code}' "$B/accreditations/ALP2601" -H "Authorization: Bearer $COB"); [ "$c" = "403" ] || [ "$c" = "404" ] && ok "firm B cannot open firm A's accreditation by ref ($c)" || no "firm B opened firm A's accreditation ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' "$B/accreditations/ALP2601/attendees" -H "Authorization: Bearer $COB"); [ "$c" = "403" ] || [ "$c" = "404" ] && ok "firm B cannot list firm A's attendees ($c)" || no "firm B listed firm A's attendees ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' "$B/courses/c-alpha-secret/materials" -H "Authorization: Bearer $COB"); { [ "$c" = "403" ] || [ "$c" = "404" ]; } && ok "firm B cannot list firm A's course materials ($c)" || no "firm B listed firm A's materials ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' "$B/courses/c-alpha-secret/materials/MAT-TEST-A/download" -H "Authorization: Bearer $COB"); { [ "$c" = "403" ] || [ "$c" = "404" ]; } && ok "firm B cannot DOWNLOAD firm A's confidential file ($c)" || no "firm B downloaded firm A's file ($c)"
c=$(curl -s -o /tmp/b -w '%{http_code}' "$B/courses/c-alpha-secret/materials" -H "Authorization: Bearer $COA"); [ "$c" = "200" ] && ok "firm A still gets its own materials ($c)" || no "firm A locked out of its own materials ($c)"

echo
echo "RESULT: $pass passed, $fail failed"
