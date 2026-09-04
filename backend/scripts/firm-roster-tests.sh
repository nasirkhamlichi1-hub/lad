#!/usr/bin/env bash
# Firm roster: add / remove / transfer-request matrix.
B=http://localhost:4000/api/v1
T(){ python3 -c "import json;print(json.load(open('/tmp/tk.json'))['$1'])"; }
CO=$(T coGal); CO2=$(T coClyde); ADM=$(T admin); LAW=$(T lawGal)
pass=0; fail=0
ok(){ printf "  ok   %s\n" "$1"; pass=$((pass+1)); }
no(){ printf "  FAIL %s  -> %s\n" "$1" "$2"; fail=$((fail+1)); }
req(){ curl -s -o /tmp/r.body -w "%{http_code}" -H "Authorization: Bearer $1" -H "Content-Type: application/json" "${@:2}"; }
body(){ cat /tmp/r.body; }
j(){ python3 -c "import json,sys;d=json.load(open('/tmp/r.body'));print($1)"; }
firmOf(){ python3 -c "
import sqlite3;print(sqlite3.connect('/home/claude/repo/backend/data/test.sqlite').execute(\"select coalesce(firm_id,'NULL') from lawyers where id='$1'\").fetchone()[0])"; }
ptsOf(){ python3 -c "
import sqlite3;print(sqlite3.connect('/home/claude/repo/backend/data/test.sqlite').execute(\"select lifetime_points from lawyers where id='$1'\").fetchone()[0])"; }

echo "── search"
c=$(req $CO "$B/firms/galadari/lawyers/search?q=fa"); [ "$(j "len(d['results'])")" = "0" ] && ok "two characters returns nothing (min 3)" || no "min 3 chars" "$(body)"
c=$(req $CO "$B/firms/galadari/lawyers/search?q=fatima"); [ "$c" = 200 ] && [ "$(j "d['results'][0]['action']")" = "add" ] && ok "unaffiliated lawyer found, action=add" || no "search unaffiliated" "$c $(body)"
[ "$(j "d['results'][0].get('points','absent')")" = "absent" ] && ok "search carries no CPD figures" || no "no CPD in search" "$(body)"
[ "$(j "[r for r in d['results'] if r['id']=='L-FREE-01'][0]['email_masked']")" = "fa…@clpd.test" ] && ok "email is masked" || no "email masked" "$(body)"
c=$(req $CO "$B/firms/galadari/lawyers/search?q=Jordan%20Hall"); [ "$(j "d['results'][0]['action']")" = "request_transfer" ] && ok "lawyer at another firm → action=request_transfer" || no "other-firm action" "$(body)"
[ "$(j "'firm' in json.dumps(d['results'][0]).lower() and 'clyde' in json.dumps(d['results'][0]).lower()")" = "False" ] && ok "…without naming the other firm" || no "other firm named" "$(body)"
# An officer's firm comes from their token; the firm id in the URL is ignored
# (the portal calls /firms/me/…). So Clyde's officer on a Galadari URL is
# acting as Clyde — the test is that nothing of Galadari's is reachable.
c=$(req $CO2 "$B/firms/galadari/lawyers/search?q=fatima"); [ "$(j "[r for r in d['results'] if r['id']=='L-FREE-01'][0]['affiliation']")" != "own" ] && ok "another firm's officer on a Galadari URL is scoped to their own firm" || no "URL scoping" "$(body)"
c=$(req $LAW "$B/firms/galadari/lawyers/search?q=fatima"); [ "$c" = 403 ] && ok "a lawyer cannot manage the roster (403)" || no "lawyer blocked" "$c"

echo "── add (unaffiliated)"
before=$(ptsOf L-FREE-01)
c=$(req $CO -X POST $B/firms/galadari/lawyers -d '{"lawyer_id":"L-FREE-01","note":"Joined 1 Sept"}'); [ "$c" = 201 ] && [ "$(j "d['outcome']")" = "added" ] && ok "officer adds an unaffiliated lawyer (201, added)" || no "add" "$c $(body)"
[ "$(firmOf L-FREE-01)" = "galadari" ] && ok "lawyers.firm_id now galadari" || no "firm_id set" "$(firmOf L-FREE-01)"
[ "$(ptsOf L-FREE-01)" = "$before" ] && ok "CPD points untouched ($before)" || no "points changed" "$(ptsOf L-FREE-01)"
req $CO $B/firms/galadari/lawyers >/dev/null; [ "$(j "any(x['id']=='L-FREE-01' for x in d)")" = "True" ] && ok "appears in the firm's roster list" || no "in roster" "$(body | head -c 200)"
c=$(req $CO -X POST $B/firms/galadari/lawyers -d '{"lawyer_id":"L-FREE-01"}'); [ "$c" = 409 ] && ok "adding again is a 409, not a silent 200" || no "double add" "$c"
c=$(req $CO -X POST $B/firms/galadari/lawyers -d '{"lawyer_id":"L-NOPE"}'); [ "$c" = 404 ] && ok "unknown lawyer id → 404" || no "unknown id" "$c"
req $LAW $B/notifications/mine >/dev/null 2>&1; true

echo "── add (at another firm) → transfer request"
c=$(req $CO -X POST $B/firms/galadari/lawyers -d '{"lawyer_id":"L-05010","note":"Moved to us in August"}'); [ "$c" = 202 ] && [ "$(j "d['outcome']")" = "transfer_requested" ] && ok "lawyer at Clyde → 202 transfer_requested, firm_id NOT changed" || no "transfer request" "$c $(body)"
RID=$(j "d['request_id']")
[ "$(firmOf L-05010)" = "clyde-co-llp" ] && ok "Jordan Hall still at Clyde" || no "firm_id changed without approval" "$(firmOf L-05010)"
c=$(req $CO -X POST $B/firms/galadari/lawyers -d '{"lawyer_id":"L-05010"}'); [ "$c" = 409 ] && ok "second request while one is open → 409" || no "duplicate request" "$c"
req $CO "$B/firms/galadari/lawyers/requests" >/dev/null; [ "$(j "d['requests'][0]['status']")" = "pending" ] && [ "$(j "d['requests'][0]['from_firm']['name']")" = "Clyde & Co LLP" ] && ok "firm sees its own pending request (from-firm named here, since LAD has accepted the request)" || no "firm request list" "$(body)"
c=$(req $CO2 "$B/firms/galadari/lawyers/requests"); [ "$(j "any(r['id']=='$RID' for r in d['requests'])")" = "False" ] && ok "Clyde's officer cannot see Galadari's request" || no "cross-firm requests" "$(body)"
c=$(req $CO -X POST $B/firms/roster-requests/$RID/decide -d '{"approve":true}'); [ "$c" = 403 ] && ok "a firm officer cannot decide a transfer (403)" || no "officer decides" "$c"

echo "── LAD decides"
req $ADM "$B/firms/roster-requests" >/dev/null; [ "$(j "any(r['id']=='$RID' for r in d['requests'])")" = "True" ] && ok "request in the Department's queue" || no "admin queue" "$(body | head -c 200)"
c=$(req $ADM -X POST $B/firms/roster-requests/$RID/decide -d '{"approve":true,"note":"Confirmed with Clyde HR"}'); [ "$c" = 200 ] && ok "admin approves (200)" || no "approve" "$c $(body)"
[ "$(firmOf L-05010)" = "galadari" ] && ok "Jordan Hall now at Galadari" || no "moved" "$(firmOf L-05010)"
c=$(req $ADM -X POST $B/firms/roster-requests/$RID/decide -d '{"approve":false}'); [ "$c" = 409 ] && ok "deciding twice → 409" || no "double decide" "$c"

echo "── remove"
c=$(req $CO2 -X DELETE $B/firms/galadari/lawyers/L-FREE-01); [ "$c" = 404 ] && [ "$(firmOf L-FREE-01)" = "galadari" ] && ok "another firm's officer cannot remove Galadari's lawyer (404, firm_id intact)" || no "cross-firm remove" "$c $(firmOf L-FREE-01)"
c=$(req $CO -X DELETE $B/firms/galadari/lawyers/L-DEMO-GAL -d '{"reason":"Left the firm 31 Aug"}'); [ "$c" = 200 ] && ok "officer removes their own lawyer (200)" || no "remove" "$c $(body)"
[ "$(firmOf L-DEMO-GAL)" = "NULL" ] && ok "firm_id now NULL — unaffiliated, not deleted" || no "firm_id" "$(firmOf L-DEMO-GAL)"
c=$(req $ADM $B/lawyers/L-DEMO-GAL); [ "$c" = 200 ] && ok "lawyer still on the roll for the Department" || no "roll entry" "$c"
c=$(req $CO -X DELETE $B/firms/galadari/lawyers/L-DEMO-GAL); [ "$c" = 404 ] && ok "removing again → 404" || no "double remove" "$c"
req $CO $B/firms/galadari/lawyers >/dev/null; [ "$(j "any(x['id']=='L-DEMO-GAL' for x in d)")" = "False" ] && ok "gone from the roster list" || no "still listed" ""

echo "── audit + notifications"
req $ADM "$B/messages/activity?firm_id=galadari" >/dev/null
python3 -c "
import json;d=json.load(open('/tmp/r.body'));k=set(a['kind'] for a in d.get('activity',d.get('rows',[])))
need={'roster_added','roster_transfer_requested','roster_transfer_approved','roster_removed'}; m=need-k
exit(0 if not m else 1)" && ok "all four roster events on the CRM timeline" || no "timeline" "$(body | head -c 300)"
python3 -c "
import sqlite3;c=sqlite3.connect('/home/claude/repo/backend/data/test.sqlite')
n=c.execute(\"select count(*) from notifications where recipient_type='lawyer' and recipient_id in ('L-FREE-01','L-05010','L-DEMO-GAL')\").fetchone()[0]
exit(0 if n>=3 else 1)" && ok "each affected lawyer was notified" || no "notifications" ""

echo; echo "passed $pass  failed $fail"; [ $fail -eq 0 ]
