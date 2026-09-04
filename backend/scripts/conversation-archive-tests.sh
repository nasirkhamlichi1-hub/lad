#!/usr/bin/env bash
# Requester archive / delete — the matrix.
B=http://localhost:4000/api/v1/messages
LAW=$(python3 -c "import json;print(json.load(open('/tmp/tk.json'))['lawGal'])")
CO=$(python3 -c "import json;print(json.load(open('/tmp/tk.json'))['coGal'])")
CO2=$(python3 -c "import json;print(json.load(open('/tmp/tk.json'))['coClyde'])")
ADM=$(python3 -c "import json;print(json.load(open('/tmp/tk.json'))['admin'])")
pass=0; fail=0
ok(){ printf "  ok   %s\n" "$1"; pass=$((pass+1)); }
no(){ printf "  FAIL %s  -> %s\n" "$1" "$2"; fail=$((fail+1)); }
req(){ curl -s -o /tmp/r.body -w "%{http_code}" -H "Authorization: Bearer $1" -H "Content-Type: application/json" "${@:2}"; }
body(){ cat /tmp/r.body; }
count(){ python3 -c "import json,sys;d=json.load(open('/tmp/r.body'));print(len(d.get('conversations',[])))"; }
has(){ python3 -c "import json,sys;d=json.load(open('/tmp/r.body'));print(any(c['id']=='$1' for c in d.get('conversations',[])))"; }

echo "── setup: lawyer opens two threads"
req $LAW -X POST $B/conversations -d '{"subject":"Points query","body":"How many points do I have?"}' >/dev/null; A=$(python3 -c "import json;print(json.load(open('/tmp/r.body'))['id'])")
req $LAW -X POST $B/conversations -d '{"subject":"Booking help","body":"Cannot book the ethics session."}' >/dev/null; Bq=$(python3 -c "import json;print(json.load(open('/tmp/r.body'))['id'])")
echo "  A=$A  B=$Bq"

echo "── list defaults"
req $LAW $B/conversations >/dev/null; [ "$(count)" = "2" ] && ok "lawyer inbox shows both" || no "lawyer inbox shows both" "$(count)"
req $LAW "$B/conversations?view=archived" >/dev/null; [ "$(count)" = "0" ] && ok "lawyer archive empty" || no "lawyer archive empty" "$(count)"

echo "── archive"
c=$(req $LAW -X POST $B/conversations/$A/archive -d '{}'); [ "$c" = 200 ] && ok "lawyer archives own thread (200)" || no "lawyer archives own thread" "$c $(body)"
req $LAW $B/conversations >/dev/null; [ "$(has $A)" = "False" ] && ok "archived thread gone from inbox" || no "archived thread gone from inbox" "$(body)"
req $LAW "$B/conversations?view=archived" >/dev/null; [ "$(has $A)" = "True" ] && ok "…and present in Archived view" || no "present in Archived view" "$(body)"
req $ADM "$B/conversations?box=all" >/dev/null; [ "$(has $A)" = "True" ] && ok "admin still sees it in the working inbox (flags independent)" || no "admin still sees it" "$(body)"
req $ADM "$B/conversations?box=all" >/dev/null; python3 -c "import json;d=json.load(open('/tmp/r.body'));c=[x for x in d['conversations'] if x['id']=='$A'][0];exit(0 if c['archived']==False else 1)" && ok "admin's archived flag is unaffected by the lawyer's" || no "admin flag unaffected" "$(body)"

echo "── admin reply resurfaces it"
req $ADM -X POST $B/conversations/$A/messages -d '{"body":"You have 11 points."}' >/dev/null
req $LAW $B/conversations >/dev/null; [ "$(has $A)" = "True" ] && ok "CLPD reply moves it back to the lawyer's inbox" || no "reply resurfaces" "$(body)"

echo "── restore round-trip"
req $LAW -X POST $B/conversations/$Bq/archive -d '{}' >/dev/null
req $LAW -X POST $B/conversations/$Bq/archive -d '{"archived":false}' >/dev/null
req $LAW $B/conversations >/dev/null; [ "$(has $Bq)" = "True" ] && ok "restore puts it back" || no "restore" "$(body)"

echo "── isolation"
c=$(req $CO2 -X POST $B/conversations/$A/archive -d '{}'); [ "$c" = 403 ] && ok "another firm's officer cannot archive it (403)" || no "cross-firm archive blocked" "$c"
c=$(req $CO2 -X DELETE $B/conversations/$A); [ "$c" = 403 ] && ok "another firm's officer cannot delete it (403)" || no "cross-firm delete blocked" "$c"
c=$(req $ADM -X DELETE $B/conversations/$A); [ "$c" = 403 ] && ok "admin cannot delete — records are retained (403)" || no "admin delete blocked" "$c"

echo "── delete"
c=$(req $LAW -X DELETE $B/conversations/$A); [ "$c" = 200 ] && ok "lawyer deletes own thread (200)" || no "lawyer delete" "$c $(body)"
req $LAW $B/conversations >/dev/null; [ "$(has $A)" = "False" ] && ok "gone from inbox" || no "gone from inbox" "$(body)"
req $LAW "$B/conversations?view=archived" >/dev/null; [ "$(has $A)" = "False" ] && ok "gone from archive too" || no "gone from archive" "$(body)"
c=$(req $LAW $B/conversations/$A); [ "$c" = 404 ] && ok "direct open returns 404 for the requester" || no "direct open 404" "$c"
c=$(req $LAW -X POST $B/conversations/$A/archive -d '{"archived":false}'); [ "$c" = 404 ] && ok "cannot un-delete via restore (404)" || no "no un-delete" "$c"
c=$(req $LAW -X DELETE $B/conversations/$A); [ "$c" = 404 ] && ok "second delete is a 404, not a 200" || no "double delete" "$c"
c=$(req $ADM $B/conversations/$A); [ "$c" = 200 ] && ok "admin can still open the Department's copy (200)" || no "admin still reads" "$c"
python3 -c "import json;d=json.load(open('/tmp/r.body'));exit(0 if d['conversation'].get('requester_deleted')==True else 1)" && ok "…and it is marked requester_deleted for them" || no "requester_deleted marker" "$(body)"
req $ADM "$B/conversations?box=all" >/dev/null; [ "$(has $A)" = "True" ] && ok "still in the admin inbox" || no "still in admin inbox" "$(body)"
req $LAW $B/unread >/dev/null; python3 -c "import json;d=json.load(open('/tmp/r.body'));exit(0 if d['unread']==0 else 1)" && ok "deleted thread does not badge the lawyer (unread=0)" || no "badge excludes deleted" "$(body)"

echo "── audit trail"
req $ADM "$B/activity?lawyer_id=L-DEMO-GAL" >/dev/null
python3 -c "
import json;d=json.load(open('/tmp/r.body'));k=[a['kind'] for a in d.get('activity',d.get('rows',[]))]
need={'requester_archived','requester_unarchived','requester_deleted'}; missing=need-set(k)
exit(0 if not missing else 1)" && ok "archive / restore / delete all logged to the CRM timeline" || no "timeline entries" "$(body | head -c 300)"

echo; echo "passed $pass  failed $fail"; [ $fail -eq 0 ]
