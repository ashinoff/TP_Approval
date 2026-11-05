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
    doc.add_paragraph('Приложение к договору № 00001-26-00000004-1')
    doc.add_paragraph('Заявитель: Учебный заявитель')
    # Как в реальных ТУ/актах: номер пункта через табуляцию и перенос строки внутри абзаца.
    item = doc.add_paragraph()
    run = item.add_run('3.')
    run.add_tab()
    item.add_run(f'Максимальная мощность: {power} кВт, в том числе существующая мощность 7 кВт.')
    doc.add_paragraph('Класс напряжения: 0,4 кВ.')
    place = doc.add_paragraph()
    run = place.add_run('Адрес объекта: Учебный адрес,')
    run.add_break()
    place.add_run('д. 15/31')
    # В акте — номинал вводного автомата и провод, как в п. 5 и на схеме реальных актов (проверка по справочникам).
    equipment = [] if name == 'engineer-tu' else ['Устройства защиты: ВА-25А.', 'Ответвление: СИП 4х16 L=10м.']
    for line in [
        'Точка присоединения: РУ-0,4 кВ ТП-У001.',
        *equipment,
        'Все данные вымышленные. Не использовать для реального согласования.',
    ]:
        doc.add_paragraph(line)
    doc.sections[0].header.paragraphs[0].text = 'Синтетический комплект без персональных данных'
    doc.save(out / f'{name}.docx')
print('Synthetic engineer TU and act DOCX fixtures created.')
