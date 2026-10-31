"""Generate synthetic DOCX fixtures only; never reads real documents."""
from pathlib import Path
from docx import Document

out = Path('.local/demo-documents')
out.mkdir(parents=True, exist_ok=True)
for version, power in [(1, '150 кВт (учебная ошибка)'), (2, '15 кВт')]:
    doc = Document()
    doc.add_heading('ДЕМОНСТРАЦИОННЫЙ АКТ ТП', 0)
    doc.add_paragraph('Синтетический документ для локальной проверки. Не является реальным актом.')
    table = doc.add_table(rows=0, cols=2)
    table.style = 'Table Grid'
    for field, value in [('Договор', 'ДЕМО-001/ТП'), ('Заявитель', 'Учебный заявитель'), ('Адрес', 'Учебный объект, условный адрес'), ('Максимальная мощность', power), ('Версия', str(version))]:
        cells = table.add_row().cells
        cells[0].text, cells[1].text = field, value
    doc.save(out / f'act-v{version}.docx')
print('Созданы .local/demo-documents/act-v1.docx и act-v2.docx')
