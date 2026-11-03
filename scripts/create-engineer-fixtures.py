"""Explicitly synthetic requisites for the engineer preflight browser test."""
from pathlib import Path
from docx import Document

out = Path('.local/demo-documents')
out.mkdir(parents=True, exist_ok=True)
for name, power, title in [
    ('engineer-tu', '15', 'ТЕХНИЧЕСКИЕ УСЛОВИЯ — УЧЕБНЫЙ ДОКУМЕНТ'),
    ('engineer-act-bad', '150', 'АКТ ТП — УЧЕБНАЯ РЕДАКЦИЯ С ОШИБКОЙ'),
    ('engineer-act-good', '15', 'АКТ ТП — ИСПРАВЛЕННАЯ УЧЕБНАЯ РЕДАКЦИЯ'),
]:
    doc = Document()
    doc.core_properties.author = 'TP_Approval synthetic tests'
    doc.add_heading(title, 0)
    for line in [
        'Приложение к договору № SYNTH-TU-0001',
        'Заявитель: Учебный заявитель',
        f'Максимальная мощность: {power} кВт, в том числе существующая мощность 7 кВт.',
        'Класс напряжения: 0,4 кВ.',
        'Адрес объекта: Учебный адрес, д. 15/31',
        'Точка присоединения: РУ-0,4 кВ ТП-У001.',
        'Все данные вымышленные. Не использовать для реального согласования.',
    ]:
        doc.add_paragraph(line)
    doc.sections[0].header.paragraphs[0].text = 'Синтетический комплект без персональных данных'
    doc.save(out / f'{name}.docx')
print('Synthetic engineer TU and act DOCX fixtures created.')
