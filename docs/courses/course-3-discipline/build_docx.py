"""Build the Rise-importable Word storyboard from storyboard.md.

Usage: python3 build_docx.py
Requires pandoc (3.x) and python-docx.
"""
import pathlib
import subprocess

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "storyboard.md"
OUT = HERE / "Course-3-Discipline-Storyboard-AR.docx"

FONT = "Dubai"  # Falls back to Segoe UI where Dubai is not installed.
INK = RGBColor(0x1A, 0x17, 0x1C)
GOLD = RGBColor(0x9C, 0x77, 0x1F)
GREY = RGBColor(0x57, 0x57, 0x57)


def set_rtl_paragraph(p):
    ppr = p._p.get_or_add_pPr()
    if ppr.find(qn("w:bidi")) is None:
        ppr.append(OxmlElement("w:bidi"))


def set_run_font(run, size=None, color=None, bold=None):
    rpr = run._r.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.insert(0, fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        fonts.set(qn(attr), FONT)
    if rpr.find(qn("w:rtl")) is None:
        rpr.append(OxmlElement("w:rtl"))
    if size:
        run.font.size = Pt(size)
        szcs = rpr.find(qn("w:szCs"))
        if szcs is None:
            szcs = OxmlElement("w:szCs")
            rpr.append(szcs)
        szcs.set(qn("w:val"), str(int(size * 2)))
    if color is not None:
        run.font.color.rgb = color
    if bold is not None:
        run.font.bold = bold
        run.font.cs_bold = bold


def style_paragraph(p):
    set_rtl_paragraph(p)
    name = p.style.name if p.style is not None else ""
    size, color, bold = 12, INK, None
    if name == "Title":
        size, bold = 26, True
    elif name == "Subtitle":
        size, color = 14, GREY
    elif name == "Heading 1":
        size, bold = 20, True
    elif name == "Heading 2":
        size, color, bold = 15, GOLD, True
    elif name == "Heading 3":
        size, bold = 13, True
    if not name.startswith("Heading") and name not in ("Title", "Subtitle"):
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    else:
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    for run in p.runs:
        set_run_font(run, size=size, color=color, bold=bold)


def style_table(table):
    tblpr = table._tbl.tblPr
    if tblpr.find(qn("w:bidiVisual")) is None:
        tblpr.append(OxmlElement("w:bidiVisual"))
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "bottom", "insideH", "left", "right", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single" if edge in ("top", "bottom", "insideH") else "nil")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:color"), "E8E8E8")
        borders.append(el)
    old = tblpr.find(qn("w:tblBorders"))
    if old is not None:
        tblpr.remove(old)
    tblpr.append(borders)
    for r_idx, row in enumerate(table.rows):
        for cell in row.cells:
            if r_idx == 0:
                shd = OxmlElement("w:shd")
                shd.set(qn("w:val"), "clear")
                shd.set(qn("w:fill"), "1A171C")
                cell._tc.get_or_add_tcPr().append(shd)
            for p in cell.paragraphs:
                set_rtl_paragraph(p)
                p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                for run in p.runs:
                    if r_idx == 0:
                        set_run_font(run, size=11, color=RGBColor(0xFF, 0xFF, 0xFF), bold=True)
                    else:
                        set_run_font(run, size=11, color=INK)


def main():
    subprocess.run(
        ["pandoc", str(SRC), "-f", "markdown", "-t", "docx", "-o", str(OUT)],
        check=True,
    )
    doc = Document(str(OUT))
    for section in doc.sections:
        sectpr = section._sectPr
        if sectpr.find(qn("w:bidi")) is None:
            sectpr.append(OxmlElement("w:bidi"))
        footer = section.footer.paragraphs[0]
        footer.text = "© 2026 دائرة الشؤون القانونية لحكومة دبي — المقرر 3: التأديب في مهنة المستشار القانوني المستقل"
        style_paragraph(footer)
        for run in footer.runs:
            set_run_font(run, size=9, color=GREY)
    for p in doc.paragraphs:
        style_paragraph(p)
    for t in doc.tables:
        style_table(t)
    doc.save(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
