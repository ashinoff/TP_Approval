"""Synthetic formatting fixtures, no real personal data. Source bytes are never rewritten by the app."""
from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

out = Path('.local/demo-documents')
out.mkdir(parents=True, exist_ok=True)
for version, power in [(1, '150'), (2, '15')]:
    doc = Document()
    section = doc.sections[0]
    section.top_margin = Cm(2)
    section.bottom_margin = Cm(2)
    section.header.paragraphs[0].text = 'УЧЕБНЫЙ КОЛОНТИТУЛ · Сочинский ПЭС'
    footer = section.footer.paragraphs[0]
    footer.text = 'Тестовый документ · Страница '
    field = OxmlElement('w:fldSimple')
    field.set(qn('w:instr'), 'PAGE')
    footer._p.append(field)
    doc.add_heading('АКТ ТП — ПРОВЕРКА ФОРМАТИРОВАНИЯ', 0)
    doc.add_paragraph('Все сведения синтетические. Документ предназначен только для тестирования.')
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Cm(1.25)
    p.add_run('Максимальная мощность: ').bold = True
    run = p.add_run(power + ' кВт')
    run.font.color.rgb = RGBColor.from_string('1D5278')
    run.font.size = Pt(12)
    doc.add_paragraph('Питающий центр: Учебный ПЦ Альфа.')
    table = doc.add_table(rows=4, cols=3)
    table.style = 'Table Grid'
    table.cell(0, 0).merge(table.cell(0, 2)).text = 'ТЕХНИЧЕСКИЕ РЕКВИЗИТЫ'
    table.cell(1, 0).merge(table.cell(2, 0)).text = 'Объединение по вертикали'
    table.cell(1, 1).text = 'Точка присоединения'
    table.cell(1, 2).text = 'Учебная опора 77'
    table.cell(2, 1).text = 'Уровень напряжения'
    table.cell(2, 2).text = '0,4 кВ'
    table.cell(3, 0).text = 'Заявитель'
    table.cell(3, 1).merge(table.cell(3, 2)).text = 'Учебный заявитель без ПДн'
    doc.add_paragraph('Условие первое — проверка нумерованного списка.', style='List Number')
    doc.add_paragraph('Условие второе — проверка отступов.', style='List Number')
    doc.add_page_break()
    doc.add_heading('Вторая страница', 1)
    doc.add_paragraph('Контрольная фраза на второй странице для проверки поиска и навигации.')
    doc.add_paragraph(f'Учебная редакция документа: {version}.')
    doc.save(out / f'complex-v{version}.docx')
print('Созданы синтетические complex-v1.docx / complex-v2.docx с таблицей, объединениями, колонтитулами, полем PAGE и разрывом страницы.')
