#!/usr/bin/env python3
"""Anonymise the LAD report: replace real Name/Email with consistent fake ones.

Same real name -> same fake name everywhere. Gender-aware first names. All other
columns (firm, course, points, status, dates) are preserved verbatim. The repo is
public, so the real source never leaves the uploads dir; only this PII-free output
is written into backend/data/.

Usage: python3 anonymize-report.py <input.xlsx> <output.xlsx>
"""
import sys, random, openpyxl

FIRST_M = ["Omar","Khalid","Yousef","Rashid","Saif","Tariq","Faisal","Hamdan","Majid","Salim",
 "Adnan","Bilal","Nasser","Hassan","Hussein","Kareem","Marwan","Rami","Ziad","Fahad",
 "Samir","Waleed","Nabil","Ayman","Jamal","Tamer","Sami","Zaid","Anwar","Ibrahim",
 "Daniel","James","Michael","David","Andrew","Thomas","Robert","Paul","Mark","Peter",
 "Raj","Arjun","Vikram","Sanjay","Anil","Rohit","Karan","Imran","Aziz","Mustafa"]
FIRST_F = ["Aisha","Fatima","Mariam","Layla","Noura","Hana","Salma","Reem","Dana","Sara",
 "Huda","Amal","Lina","Yasmin","Rania","Maha","Nadia","Farah","Dina","Hessa",
 "Emma","Olivia","Sophia","Charlotte","Grace","Hannah","Laura","Claire","Anna","Julia",
 "Priya","Anjali","Divya","Meera","Kavya","Sneha","Pooja","Zara","Aaliyah","Leila"]
LAST = ["Al Mansouri","Al Maktoum","Al Suwaidi","Al Naqbi","Al Hashimi","Al Farsi","Al Zaabi",
 "Al Marri","Al Shamsi","Al Qassimi","Al Rashid","Al Habtoor","Al Mazrouei","Al Ali","Al Khoury",
 "Haddad","Khoury","Nassar","Saliba","Rahman","Iqbal","Khan","Patel","Sharma","Mehta",
 "Smith","Jones","Brown","Wilson","Taylor","Walker","Hughes","Clarke","Murphy","Bennett",
 "Costa","Silva","Romano","Bianchi","Fischer","Weber","Hoffmann","Dubois","Laurent","Moreau",
 "Petrov","Novak","Kovac","Hansen","Berg","Larsen"]

def main():
    inp, out = sys.argv[1], sys.argv[2]
    wb = openpyxl.load_workbook(inp, read_only=True, data_only=True)
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    idx = {h: i for i, h in enumerate(header)}
    NAME = idx.get('Name'); EMAIL = idx.get('Email'); GEN = idx.get('Gender'); LID = idx.get('Firm/Lawyer ID')

    rows = [list(r) for r in it]
    # gender per distinct real name (first occurrence wins)
    gender = {}
    for r in rows:
        nm = (r[NAME] or '').strip()
        if nm and nm not in gender:
            gender[nm] = (str(r[GEN]).strip().lower() if r[GEN] else '')

    names = sorted(gender.keys())
    rnd = random.Random(20260619)  # fixed seed -> reproducible
    used = set(); name_map = {}; email_map = {}; ecount = {}
    for nm in names:
        g = gender[nm]
        pool = FIRST_F if g.startswith('f') else (FIRST_M if g.startswith('m') else (FIRST_M+FIRST_F))
        for _ in range(200):
            fn = rnd.choice(pool); ln = rnd.choice(LAST); full = fn + ' ' + ln
            if full not in used:
                used.add(full); break
        else:
            full = fn + ' ' + ln + ' ' + str(len(used))
        name_map[nm] = full
        base = (fn + '.' + ln.replace(' ', '')).lower()
        ecount[base] = ecount.get(base, 0) + 1
        email_map[nm] = base + (str(ecount[base]) if ecount[base] > 1 else '') + '@example.ae'

    for r in rows:
        nm = (r[NAME] or '').strip()
        if nm:
            r[NAME] = name_map[nm]
            if EMAIL is not None:
                r[EMAIL] = email_map[nm]

    wbo = openpyxl.Workbook(); wso = wbo.active
    wso.append(header)
    for r in rows: wso.append(r)
    wbo.save(out)
    print("rows:", len(rows), "distinct real names mapped:", len(name_map), "-> fake (unique:", len(set(name_map.values())), ")")
    print("wrote", out)

if __name__ == '__main__':
    main()
