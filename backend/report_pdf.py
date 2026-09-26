"""A4 PDF report for one Cardiac Nexus analysis.

Built with ReportLab so the document is identical on every computer. Every page
carries the Cardiac Nexus logo and name, the analysis ID, page numbers and the
research-use notice. The body reproduces the analysis result exactly; it adds no
values of its own.
"""

from __future__ import annotations

import base64
import io
import os
from datetime import datetime
from pathlib import Path

import matplotlib
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ASSETS = Path(__file__).resolve().parent / "assets"
SITE_NAME = "Cardiac Nexus"
SITE_TAGLINE = "Explainable Cardiovascular AI"
INSTITUTION = "SJC Institute of Technology"
SITE_URL = os.getenv("REPORT_SITE_URL", "")

TEAL = colors.HexColor("#0d7482")
NAVY = colors.HexColor("#102d42")
MUTED = colors.HexColor("#66808f")
RULE = colors.HexColor("#d6e4e8")
TINT = colors.HexColor("#f2f8f9")
LEVEL = {
    "High": (colors.HexColor("#c6394b"), colors.HexColor("#fde8ea")),
    "Moderate": (colors.HexColor("#b87400"), colors.HexColor("#fff3dc")),
    "Low": (colors.HexColor("#237650"), colors.HexColor("#e5f6ee")),
}
DOT = {"high": "#c6394b", "moderate": "#d08a12", "info": "#8aa4b0", "ok": "#2f9e6a"}

# DejaVu ships with matplotlib and covers symbols such as ± and ² that the PDF
# base fonts cannot draw.
_FONT_DIR = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
pdfmetrics.registerFont(TTFont("Body", str(_FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Body-Bold", str(_FONT_DIR / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Body-Italic", str(_FONT_DIR / "DejaVuSans-Oblique.ttf")))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic")

STYLES = {
    "title": ParagraphStyle("title", fontName="Body-Bold", fontSize=16, leading=20, textColor=NAVY),
    "h2": ParagraphStyle("h2", fontName="Body-Bold", fontSize=11.5, leading=15, textColor=TEAL,
                         spaceBefore=10, spaceAfter=5),
    "h3": ParagraphStyle("h3", fontName="Body-Bold", fontSize=9.5, leading=13, textColor=NAVY,
                         spaceBefore=4, spaceAfter=3),
    "body": ParagraphStyle("body", fontName="Body", fontSize=8.8, leading=12.5, textColor=NAVY),
    "small": ParagraphStyle("small", fontName="Body", fontSize=7.6, leading=10.5, textColor=MUTED),
    "note": ParagraphStyle("note", fontName="Body", fontSize=7.8, leading=10.8,
                           textColor=colors.HexColor("#7a5310")),
    "cell": ParagraphStyle("cell", fontName="Body", fontSize=8.4, leading=11, textColor=NAVY, alignment=TA_LEFT),
    "cellb": ParagraphStyle("cellb", fontName="Body-Bold", fontSize=8.4, leading=11, textColor=NAVY),
    "label": ParagraphStyle("label", fontName="Body", fontSize=7, leading=9, textColor=MUTED),
}

MRI_MEASUREMENTS = [
    ("lv_end_diastolic_ml", "LV volume, heart full (end-diastole)", "mL"),
    ("lv_end_systolic_ml", "LV volume, heart squeezed (end-systole)", "mL"),
    ("lv_ejection_fraction", "LV ejection fraction", "%"),
    ("rv_end_diastolic_ml", "RV volume, heart full", "mL"),
    ("rv_ejection_fraction", "RV ejection fraction", "%"),
    ("myocardial_mass_g", "Heart muscle mass", "g"),
    ("lv_volume_ml", "LV volume", "mL"),
    ("rv_volume_ml", "RV volume", "mL"),
    ("myo_volume_ml", "Heart muscle volume", "mL"),
]


def _escape(text) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _p(text, style="body"):
    return Paragraph(_escape(text), STYLES[style])


def _pct(p: float) -> str:
    return f"{round(p * 100)}%"


def _image(data_url: str, width: float) -> Image | None:
    if not data_url or "," not in data_url:
        return None
    raw = base64.b64decode(data_url.split(",", 1)[1])
    reader = ImageReader(io.BytesIO(raw))
    w, h = reader.getSize()
    return Image(io.BytesIO(raw), width=width, height=width * h / w)


def _table(rows, widths, header=True, zebra=True):
    table = Table(rows, colWidths=widths, hAlign="LEFT", repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), TEAL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                  ("FONTNAME", (0, 0), (-1, 0), "Body-Bold"), ("FONTSIZE", (0, 0), (-1, 0), 8)]
    if zebra:
        for i in range(1 if header else 0, len(rows)):
            if i % 2 == 0:
                style.append(("BACKGROUND", (0, i), (-1, i), TINT))
    table.setStyle(TableStyle(style))
    return table


def _bar(probability: float, over: bool) -> Table:
    """A small horizontal bar drawn as a two-cell table."""
    width = 42 * mm
    filled = max(0.5, width * probability)
    bar = Table([["", ""]], colWidths=[filled, max(0.5, width - filled)], rowHeights=[3.2 * mm])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), TEAL if over else colors.HexColor("#8fc1cb")),
        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#e6eff2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return bar


def _probability_table(items):
    rows = [["Finding", "Probability", ""]]
    for item in items:
        over = item["probability"] >= 0.5
        rows.append([_p(item["label"], "cellb" if over else "cell"), _p(_pct(item["probability"]), "cellb" if over else "cell"),
                     _bar(item["probability"], over)])
    return _table(rows, [72 * mm, 24 * mm, 48 * mm])


class _NumberedCanvas(pdf_canvas.Canvas):
    """Draws the header and footer on every page once the page count is known."""

    def __init__(self, *args, analysis_id: str = "", generated: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []
        self._analysis_id = analysis_id
        self._generated = generated

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self._decorate(total)
            super().showPage()
        super().save()

    def _decorate(self, total: int):
        width, height = A4
        top = height - 14 * mm
        logo = ASSETS / "cardiac-nexus-logo.png"
        if logo.exists():
            self.drawImage(str(logo), 15 * mm, top - 11 * mm, width=13 * mm, height=12 * mm,
                           preserveAspectRatio=True, mask="auto")
        self.setFillColor(NAVY)
        self.setFont("Body-Bold", 14)
        self.drawString(31 * mm, top - 4.5 * mm, "Cardiac")
        self.setFillColor(TEAL)
        self.drawString(31 * mm + pdfmetrics.stringWidth("Cardiac ", "Body-Bold", 14), top - 4.5 * mm, "Nexus")
        self.setFillColor(MUTED)
        self.setFont("Body", 6.8)
        self.drawString(31 * mm, top - 9 * mm, SITE_TAGLINE.upper() + (f"  ·  {SITE_URL}" if SITE_URL else ""))

        crest = ASSETS / "sjcit-logo.png"
        right = width - 15 * mm
        if crest.exists():
            self.drawImage(str(crest), right - 9 * mm, top - 10 * mm, width=9 * mm, height=9 * mm,
                           preserveAspectRatio=True, mask="auto")
        self.setFillColor(NAVY)
        self.setFont("Body-Bold", 9)
        self.drawRightString(right - 11 * mm, top - 4 * mm, "Multimodal Analysis Report")
        self.setFont("Body", 7)
        self.setFillColor(MUTED)
        self.drawRightString(right - 11 * mm, top - 8.2 * mm, INSTITUTION)

        self.setStrokeColor(TEAL)
        self.setLineWidth(1.2)
        self.line(15 * mm, top - 13.5 * mm, width - 15 * mm, top - 13.5 * mm)

        self.setStrokeColor(RULE)
        self.setLineWidth(0.6)
        self.line(15 * mm, 16 * mm, width - 15 * mm, 16 * mm)
        self.setFont("Body", 6.8)
        self.setFillColor(MUTED)
        self.drawString(15 * mm, 11.5 * mm, "Research prototype. Not a medical device and not a medical prescription.")
        self.drawString(15 * mm, 8 * mm, f"Analysis {self._analysis_id}  ·  Generated {self._generated}")
        self.drawRightString(width - 15 * mm, 11.5 * mm, f"Page {self._pageNumber} of {total}")


def build_report_pdf(result: dict) -> bytes:
    buffer = io.BytesIO()
    generated = datetime.now().strftime("%d %b %Y, %H:%M")
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=34 * mm, bottomMargin=22 * mm,
                            title=f"Cardiac Nexus report {result.get('id', '')}",
                            author=SITE_NAME, subject="Multimodal cardiovascular analysis")
    full = A4[0] - 30 * mm
    story = []

    created = result.get("created_at")
    try:
        created_text = datetime.fromisoformat(created).astimezone().strftime("%d %b %Y, %H:%M")
    except (TypeError, ValueError):
        created_text = created or "-"
    inputs = result.get("inputs", {})
    body_size = "-"
    if inputs.get("height_cm") and inputs.get("weight_kg"):
        body_size = f"{inputs['height_cm']:g} cm, {inputs['weight_kg']:g} kg"

    story.append(_p("Multimodal Cardiovascular Analysis", "title"))
    story.append(Spacer(1, 3 * mm))
    info = [
        [_p("PATIENT", "label"), _p("AGE / SEX", "label"), _p("HEIGHT / WEIGHT", "label"), _p("ANALYSIS DATE", "label")],
        [_p(result.get("patient_name", "-"), "cellb"),
         _p(f"{result.get('patient_age', '-')} / {result.get('patient_gender', '-')}", "cellb"),
         _p(body_size, "cellb"), _p(created_text, "cellb")],
        [_p("ANALYSIS ID", "label"), _p("ECG FILE", "label"), _p("MRI FILE(S)", "label"), ""],
        [_p(result.get("id", "-"), "cell"), _p(inputs.get("ecg_file") or "-", "cell"),
         _p(", ".join(inputs.get("mri_files") or []) or "-", "cell"), ""],
    ]
    info_table = Table(info, colWidths=[52 * mm, 40 * mm, 42 * mm, full - 134 * mm])
    info_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, RULE), ("BACKGROUND", (0, 0), (-1, -1), TINT),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 2), (-1, 2), 7),
        ("SPAN", (2, 2), (3, 2)), ("SPAN", (2, 3), (3, 3)),
    ]))
    story.append(info_table)

    # Summary
    summary = result["summary"]
    ink, fill = LEVEL.get(summary["attention"], (NAVY, TINT))
    level = Table([[_p("ATTENTION LEVEL", "label")],
                   [Paragraph(summary["attention"], ParagraphStyle("lvl", fontName="Body-Bold", fontSize=20,
                                                                   leading=24, textColor=ink))]],
                  colWidths=[38 * mm])
    level.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), fill), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                               ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    reasons = [[Paragraph(f'<font color="{DOT.get(r["level"], "#8aa4b0")}">●</font>', STYLES["cell"]),
                _p(r["modality"].upper(), "cellb"), _p(r["text"], "cell")] for r in summary["reasons"]]
    reason_table = Table(reasons, colWidths=[5 * mm, 18 * mm, full - 38 * mm - 30 * mm])
    reason_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                                      ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5), ("LEFTPADDING", (0, 0), (-1, -1), 2)]))
    box = Table([[level, reason_table]], colWidths=[42 * mm, full - 42 * mm])
    box.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.8, ink),
                             ("LINEBEFORE", (0, 0), (0, -1), 4, ink), ("TOPPADDING", (0, 0), (-1, -1), 6),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [_p("1. Summary", "h2"), box, Spacer(1, 2 * mm), _p(summary["method"], "small")]

    # Clinical
    clinical = result["clinical"]
    rows = [["Item", "Finding", "Status"]]
    status_text = {"high": "Needs attention", "moderate": "Raised", "info": "Information", "ok": "Normal"}
    for flag in clinical["flags"]:
        rows.append([_p(flag["item"], "cellb"), _p(flag["text"], "cell"),
                     Paragraph(f'<font color="{DOT.get(flag["level"], "#8aa4b0")}">●</font> '
                               f'{status_text.get(flag["level"], flag["level"])}', STYLES["cell"])])
    story += [_p("2. Clinical values", "h2"), _p(clinical["method"], "small"), Spacer(1, 2 * mm),
              _table(rows, [36 * mm, full - 36 * mm - 32 * mm, 32 * mm])]

    # ECG
    ecg = result["ecg"]
    source = ("Read from an image of a printout by the digitizer" if ecg["source"]["type"] == "image"
              else "12-lead signal")
    story += [_p("3. ECG analysis", "h2"),
              _p(f"Input: {source}. Model: xresnet1d18 classifier over five diagnostic findings, with calibrated "
                 f"probabilities.", "small"), Spacer(1, 2 * mm),
              _probability_table(ecg["findings"]), Spacer(1, 2 * mm),
              Paragraph(
                  f"Explanation shown for <b>{_escape(ecg['explained_class']['label'])}</b> "
                  f"({_pct(ecg['explained_class']['probability'])}). Leads the model relied on most: "
                  + ", ".join(f"{lead['lead']} ({_pct(lead['share'])})" for lead in ecg["leads_most_relied_on"]) + ".",
                  STYLES["body"])]
    figure = _image(ecg.get("attribution_image"), full)
    if figure:
        story += [Spacer(1, 2 * mm), KeepTogether([figure, _p(
            "Integrated Gradients: red shading marks the parts of each lead that pushed the model towards the "
            "finding; blue marks parts that argued against it.", "small")])]
    for note in ecg.get("notes", []):
        story.append(_p(f"Note: {note}", "note"))
    story.append(_p(" ".join(filter(None, [ecg.get("evidence"), ecg["source"].get("evidence")])), "small"))

    # MRI
    mri = result["mri"]
    story += [_p("4. Cardiac MRI analysis", "h2"),
              _p("Model: 2.5D U-Net segmentation of the left ventricle, right ventricle and heart muscle. Every "
                 "measurement is computed from the model's outlines.", "small"), Spacer(1, 2 * mm)]
    rows = [["Measurement", "Value", "Reference"]]
    measurements = mri.get("measurements", {})
    for key, label, unit in MRI_MEASUREMENTS:
        if key in measurements:
            reference = ""
            if key == "lv_ejection_fraction":
                reference = f"50% or above is normal · {measurements.get('lv_ejection_fraction_category', '')}"
            rows.append([_p(label, "cell"), _p(f"{measurements[key]} {unit}", "cellb"), _p(reference, "cell")])
    if len(rows) > 1:
        story.append(_table(rows, [78 * mm, 30 * mm, full - 108 * mm]))
    if mri.get("diagnosis"):
        diagnosis = mri["diagnosis"]
        story += [_p("Diagnosis from heart measurements", "h3"), _probability_table(diagnosis["probabilities"]),
                  Spacer(1, 1.5 * mm), _p("Because:", "body")]
        story += [_p(f"•  {b}", "body") for b in diagnosis["because"]]
        story.append(_p(diagnosis.get("evidence", ""), "small"))
    figure = _image(mri.get("segmentation_image"), full * 0.82)
    if figure:
        story += [Spacer(1, 2 * mm), KeepTogether([figure, _p(
            "The model's outline: red right ventricle, dark blue heart muscle, teal left ventricle.", "small")])]
    for note in mri.get("notes", []):
        story.append(_p(f"Note: {note}", "note"))
    story.append(_p(mri.get("evidence", ""), "small"))

    # Review and notice
    sign = Table([[_p("Reviewed by (clinician)", "label"), _p("Signature", "label"), _p("Date", "label")],
                  ["", "", ""]], colWidths=[full / 3] * 3, rowHeights=[5 * mm, 12 * mm])
    sign.setStyle(TableStyle([("LINEBELOW", (0, 1), (-1, 1), 0.6, MUTED), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 10)]))
    story += [_p("5. Review and important notice", "h2"),
              _p(result.get("disclaimer", ""), "body"), Spacer(1, 1.5 * mm),
              _p("This report is generated by a research prototype built as a final-year engineering project. "
                 "The figures are model outputs that must be reviewed by a qualified clinician before any use.",
                 "small"),
              Spacer(1, 6 * mm), KeepTogether([sign])]

    doc.build(story, canvasmaker=lambda *a, **k: _NumberedCanvas(
        *a, analysis_id=result.get("id", ""), generated=generated, **k))
    return buffer.getvalue()
