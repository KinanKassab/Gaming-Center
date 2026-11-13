from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


OUTPUT = Path(__file__).with_name("Akodus_Gaming_Center_Capabilities_AR.docx")
FONT = "Arial"
BLACK = "000000"
NAVY = "17365D"
LIGHT_BLUE = "EAF2F8"
LIGHT_GRAY = "F5F7F9"
BORDER = "D9D9D9"
GREEN = "E8F5E9"
AMBER = "FFF4D6"
RED = "FDECEC"


def set_rtl(paragraph, alignment=WD_ALIGN_PARAGRAPH.RIGHT):
    paragraph.alignment = alignment
    p_pr = paragraph._p.get_or_add_pPr()
    bidi = p_pr.find(qn("w:bidi"))
    if bidi is None:
        bidi = OxmlElement("w:bidi")
        p_pr.append(bidi)
    bidi.set(qn("w:val"), "1")


def set_run_font(run, size=None, bold=None, color=BLACK):
    run.font.name = FONT
    run._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    run._element.rPr.rFonts.set(qn("w:cs"), FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def set_cell_fill(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shading = tc_pr.find(qn("w:shd"))
    if shading is None:
        shading = OxmlElement("w:shd")
        tc_pr.append(shading)
    shading.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=120, start=150, bottom=120, end=150):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        tag = "w:" + edge
        node = tc_mar.find(qn(tag))
        if node is None:
            node = OxmlElement(tag)
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        node = borders.find(qn("w:" + edge))
        if node is None:
            node = OxmlElement("w:" + edge)
            borders.append(node)
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), "6")
        node.set(qn("w:color"), BORDER)


def set_table_rtl(table):
    tbl_pr = table._tbl.tblPr
    bidi = tbl_pr.find(qn("w:bidiVisual"))
    if bidi is None:
        bidi = OxmlElement("w:bidiVisual")
        tbl_pr.append(bidi)
    bidi.set(qn("w:val"), "1")


def set_keep_with_next(paragraph):
    paragraph.paragraph_format.keep_with_next = True


def add_heading(doc, text, level=1):
    paragraph = doc.add_paragraph(style=f"Heading {level}")
    set_rtl(paragraph)
    set_keep_with_next(paragraph)
    run = paragraph.add_run(text)
    set_run_font(run, 15 if level == 1 else 12.5, True)
    return paragraph


def add_body(doc, text, bold_lead=None):
    paragraph = doc.add_paragraph(style="Body Text")
    set_rtl(paragraph)
    if bold_lead and text.startswith(bold_lead):
        lead = paragraph.add_run(bold_lead)
        set_run_font(lead, 10.2, True)
        rest = paragraph.add_run(text[len(bold_lead):])
        set_run_font(rest, 10.2)
    else:
        run = paragraph.add_run(text)
        set_run_font(run, 10.2)
    return paragraph


def add_bullet(doc, text):
    paragraph = doc.add_paragraph(style="List Bullet")
    set_rtl(paragraph)
    run = paragraph.add_run(text)
    set_run_font(run, 10.2)
    return paragraph


def add_status_table(doc):
    headers = ["القدرة", "الحالة الفعلية", "ما يعمل الآن", "أثر المفتاح في الإعدادات"]
    rows = [
        [
            "صالة الألعاب",
            "تعمل",
            "الأجهزة والمناطق والأسعار والجلسات والبدء والإيقاف والاستئناف والنقل والإنهاء والتحصيل المرتبط بالجلسة.",
            "يُحفظ الاختيار ويظهر في سجل التدقيق، لكنه لا يمنع فتح الصالة أو تشغيل الجلسات حالياً.",
        ],
        [
            "نقطة البيع",
            "تعمل جزئياً",
            "كتالوج منتجات غير مخزنية، أسعار، إضافة منتج إلى جلسة مفتوحة، وضم المبلغ إلى التحصيل.",
            "يُحفظ الاختيار فقط؛ لا يعطل وظائف البيع المتاحة حالياً.",
        ],
        [
            "تتبّع المخزون",
            "غير مطبّق",
            "لا توجد حركة مخزون أو أرصدة كميات تشغيلية. النظام يرفض تفعيل التتبع على منتج مخزني في هذه المرحلة.",
            "تشغيل المفتاح لا ينشئ مخزوناً ولا يفعّل خصم الكميات.",
        ],
        [
            "زوّار بدون تسجيل",
            "تعمل",
            "يقرأ النظام الإعداد عند بدء الجلسة ويمنع جلسة الزائر عندما تكون القيمة لا.",
            "هذا إعداد تشغيلي فعلي، ويمكن تطبيقه على النشاط أو على فرع محدد.",
        ],
    ]

    table = doc.add_table(rows=1, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_rtl(table)
    set_table_borders(table)
    widths = [Cm(3.0), Cm(2.7), Cm(6.1), Cm(4.5)]
    for index, header in enumerate(headers):
        cell = table.rows[0].cells[index]
        cell.width = widths[index]
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_fill(cell, NAVY)
        set_cell_margins(cell)
        paragraph = cell.paragraphs[0]
        set_rtl(paragraph, WD_ALIGN_PARAGRAPH.CENTER)
        run = paragraph.add_run(header)
        set_run_font(run, 9.2, True, "FFFFFF")

    status_fills = {"تعمل": GREEN, "تعمل جزئياً": AMBER, "غير مطبّق": RED}
    for row_index, values in enumerate(rows, start=1):
        cells = table.add_row().cells
        for col_index, value in enumerate(values):
            cell = cells[col_index]
            cell.width = widths[col_index]
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell)
            set_cell_fill(cell, LIGHT_GRAY if row_index % 2 == 0 else "FFFFFF")
            if col_index == 1:
                set_cell_fill(cell, status_fills.get(value, LIGHT_BLUE))
            paragraph = cell.paragraphs[0]
            set_rtl(paragraph, WD_ALIGN_PARAGRAPH.CENTER if col_index == 1 else WD_ALIGN_PARAGRAPH.RIGHT)
            run = paragraph.add_run(value)
            set_run_font(run, 9.0, col_index in (0, 1))

    doc.add_paragraph()


def configure_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    normal._element.rPr.rFonts.set(qn("w:cs"), FONT)
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(BLACK)

    body = doc.styles["Body Text"]
    body.font.name = FONT
    body.font.size = Pt(10.2)
    body.paragraph_format.space_after = Pt(5)
    body.paragraph_format.line_spacing = 1.12

    for style_name, size in (("Title", 24), ("Heading 1", 15), ("Heading 2", 12.5)):
        style = doc.styles[style_name]
        style.font.name = FONT
        style._element.rPr.rFonts.set(qn("w:ascii"), FONT)
        style._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
        style._element.rPr.rFonts.set(qn("w:cs"), FONT)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(BLACK)
        style.paragraph_format.space_before = Pt(10 if style_name == "Heading 1" else 7)
        style.paragraph_format.space_after = Pt(4)

    title_p_pr = doc.styles["Title"]._element.get_or_add_pPr()
    title_border = title_p_pr.find(qn("w:pBdr"))
    if title_border is not None:
        title_p_pr.remove(title_border)


def build_document():
    doc = Document()
    configure_styles(doc)
    section = doc.sections[0]
    section.top_margin = Cm(1.55)
    section.bottom_margin = Cm(1.55)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

    title = doc.add_paragraph(style="Title")
    set_rtl(title, WD_ALIGN_PARAGRAPH.CENTER)
    set_keep_with_next(title)
    title_run = title.add_run("شرح قدرات نظام أكودوس لمركز الألعاب")
    set_run_font(title_run, 24, True)

    subtitle = doc.add_paragraph()
    set_rtl(subtitle, WD_ALIGN_PARAGRAPH.CENTER)
    subtitle_run = subtitle.add_run("تقرير حالة التنفيذ الفعلية")
    set_run_font(subtitle_run, 12, True, NAVY)

    meta = doc.add_paragraph()
    set_rtl(meta, WD_ALIGN_PARAGRAPH.CENTER)
    meta_run = meta.add_run("التاريخ 5 أكتوبر 2026    النطاق نسخة التطوير المحلية")
    set_run_font(meta_run, 9, False, "666666")
    meta.paragraph_format.space_after = Pt(16)

    add_heading(doc, "الخلاصة التنفيذية")
    add_body(
        doc,
        "صالة الألعاب تعمل فعلياً، ونقطة البيع تعمل ضمن نطاق البيع المرتبط بجلسة، أما تتبّع المخزون فغير مطبّق بعد. مفاتيح القدرات الثلاثة في صفحة الإعدادات تحفظ اختيار المؤسسة وتكتب حدثاً في سجل التدقيق، لكنها لا تتحكم حالياً بفتح الصفحات أو تنفيذ العمليات.",
    )
    add_body(
        doc,
        "إعداد الزوّار بدون تسجيل مختلف عن مفاتيح القدرات: النظام يقرأه عند بدء الجلسة ويطبّقه فعلياً، لذلك إيقافه يمنع بدء جلسة بلا زبون مسجل.",
    )

    add_heading(doc, "ملخص الحالة")
    add_status_table(doc)

    add_heading(doc, "تشغيل صالة الألعاب")
    add_body(doc, "الحالة: تعمل ضمن النطاق التشغيلي الحالي.", bold_lead="الحالة:")
    add_bullet(doc, "تعريف الفروع والمناطق وأنواع الأجهزة والأجهزة، مع عزل بيانات كل مؤسسة وفروعها.")
    add_bullet(doc, "تحديد الأسعار الساعية والعروض، ثم أخذ لقطة سعر تاريخية عند تشغيل الجلسة.")
    add_bullet(doc, "بدء الجلسة وإيقافها مؤقتاً واستئنافها ونقلها وإنهاؤها، مع منع شغل الجهاز بجلسة ثانية في الوقت نفسه.")
    add_bullet(doc, "حساب الفاتورة النهائية والتحصيل وربط الدفعة بالجلسة، مع دعم الدفعات الجزئية للزبون المسجل.")
    add_bullet(doc, "تطبيق صلاحيات الموظف وصلاحيات الفرع في الخادم، وعدم قبول معرّف المؤسسة من المتصفح كمصدر ثقة.")
    add_body(
        doc,
        "الحدود الحالية: تحديث شاشة الصالة يعتمد على إعادة الجلب وليس بثاً لحظياً عبر WebSocket. بعض قرارات المنتج مثل الإنهاء التلقائي للجلسات المحددة المدة ما زالت مؤجلة.",
        bold_lead="الحدود الحالية:",
    )

    add_heading(doc, "نقطة البيع")
    add_body(doc, "الحالة: تعمل جزئياً ضمن الجلسات، وليست نقطة بيع مستقلة كاملة.", bold_lead="الحالة:")
    add_bullet(doc, "إنشاء منتج غير مخزني باسم وسعر وحفظه في كتالوج المؤسسة.")
    add_bullet(doc, "إضافة منتج إلى جلسة نشطة أو متوقفة وتسجيل الكمية المباعة داخل الطلب.")
    add_bullet(doc, "ضم مبالغ المنتجات إلى تحصيل الجلسة مع بقاء سجل الطلب وبنوده محفوظاً.")
    add_body(
        doc,
        "غير متاح حالياً: بيع مستقل من الكاونتر بلا جلسة، خصم المخزون، المشتريات والتوريد، المرتجعات والإلغاءات المالية، الورديات والصناديق، والإيصال المالي النظامي.",
        bold_lead="غير متاح حالياً:",
    )

    add_heading(doc, "تتبّع المخزون")
    add_body(doc, "الحالة: غير مطبّق.", bold_lead="الحالة:")
    add_body(
        doc,
        "يوجد في تعريف المنتج حقل يشير إلى رغبة تتبّع المخزون، لكن لا توجد أرصدة مخزون أو حركات إدخال وإخراج أو مشتريات تشغيلية مكتملة. طبقة الكتالوج ترفض حالياً إنشاء منتج مخزني مع تفعيل التتبع حتى لا تعرض كمية غير صحيحة أو تخصم رصيداً وهمياً.",
    )
    add_body(
        doc,
        "لهذا السبب يظهر حقل الكمية في معالج الإعداد بحالة غير متاح حالياً. إدخال رقم من دون حركة مخزون محاسبية وربط بالفرع سيخالف قواعد النظام، لذلك لم يُضف تخزين مؤقت مضلل.",
    )

    add_heading(doc, "الزوّار بدون تسجيل")
    add_body(doc, "الحالة: إعداد فعلي ومطبّق.", bold_lead="الحالة:")
    add_body(
        doc,
        "عند بدء جلسة بلا زبون، يقرأ الخادم القيمة الفعالة للإعداد gaming.allow_guest_sessions على مستوى المؤسسة أو الفرع. إذا كانت القيمة لا، تُرفض العملية. إذا كانت نعم، تُنشأ جلسة زائر من دون صف زبون وهمي.",
    )
    add_body(
        doc,
        "جلسة الزائر يجب تسديدها كاملة عند التحصيل؛ أما الزبون المسجل فيمكن أن يبقى عليه رصيد وفق قواعد دفتر الحساب.",
    )

    add_heading(doc, "ماذا تفعل مفاتيح القدرات الآن")
    add_body(
        doc,
        "المفاتيح gaming.floor و pos.sales و inventory.stock تُحفظ في جدول إعدادات قدرات المؤسسة، ويُكتب تعديلها في سجل التدقيق. لا يوجد في مسارات الصالة أو البيع أو المخزون استعلام يقرأ هذه القيم قبل التنفيذ، ولذلك تغييرها لا يشغّل ولا يوقف الوظيفة فعلياً اليوم.",
    )
    add_body(
        doc,
        "هذا لا يؤثر في أمان البيانات: عزل المؤسسات وصلاحيات الموظفين والفروع تبقى مطبقة دائماً. لكنه يعني أن واجهة المفتاح تمثل حالة تجهيز أو قراراً مستقبلياً، وليست مفتاح تعطيل تشغيلي مكتمل.",
    )

    add_heading(doc, "التوصية العملية")
    add_bullet(doc, "الإبقاء على وصف واضح في صفحة الإعدادات بأن مفاتيح القدرات حالة تجهيز محفوظة وليست بوابة تشغيل حالية.")
    add_bullet(doc, "عند تنفيذ بوابة تشغيل حقيقية، يجب قراءتها في الخادم وفي التنقل والواجهات، مع اختبارات تمنع تجاوزها عبر API.")
    add_bullet(doc, "تنفيذ المخزون كوحدة كاملة تعتمد حركات غير قابلة للتلاعب، وأرصدة لكل فرع، ومعاملات ذرية مع البيع؛ لا يُنصح بحقل كمية قابل للتعديل مباشرة.")
    add_bullet(doc, "إكمال نقطة البيع المستقلة والمرتجعات والورديات قبل وصف الوحدة بأنها نقطة بيع كاملة.")

    add_heading(doc, "مرجع التحقق داخل المشروع")
    references = [
        "src/modules/gaming/sessions.ts  تطبيق إعداد الزوار ودورة حياة الجلسة",
        "src/modules/settings/features.ts  حفظ مفاتيح القدرات وسجل التدقيق",
        "src/modules/catalog/products.ts  المنتجات ورفض تتبّع المخزون في المرحلة الحالية",
        "src/modules/pos/orders.ts  طلبات المنتجات المرتبطة بالجلسة",
        "src/modules/finance/checkout.ts  التحصيل والدفعات",
        "docs/architecture/IMPLEMENTATION_STATUS.md  حدود المرحلة وحالة التنفيذ",
    ]
    for reference in references:
        add_bullet(doc, reference)

    footer = section.footer.paragraphs[0]
    set_rtl(footer, WD_ALIGN_PARAGRAPH.CENTER)
    footer_run = footer.add_run("أكودوس لمراكز الألعاب    حالة التنفيذ المحلية")
    set_run_font(footer_run, 8, False, "777777")

    doc.core_properties.title = "شرح قدرات نظام أكودوس لمركز الألعاب"
    doc.core_properties.subject = "حالة تنفيذ صالة الألعاب ونقطة البيع والمخزون وإعداد الزوار"
    doc.core_properties.author = "Akodus"
    doc.save(OUTPUT)


if __name__ == "__main__":
    build_document()
    print(OUTPUT)
