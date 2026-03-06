import pandas as pd
import openpyxl

def process_excel_upload(file_path: str) -> list[dict]:
    """
    Reads an uploaded excel file, detects 'Question' and 'Answer' columns, 
    and returns a structured dict of rows.
    """
    df = pd.read_excel(file_path)
    
    q_col = None
    a_col = None
    
    for col in df.columns:
        col_str = str(col).lower()
        if "question" in col_str:
            q_col = col
        if "answer" in col_str or "response" in col_str:
            a_col = col
            
    if not q_col:
        q_col = df.columns[0]
    if not a_col:
        if len(df.columns) > 1:
            a_col = df.columns[1]
        else:
            return []

    rows = []
    for idx, row in df.iterrows():
        question = row[q_col]
        answer = row[a_col]
        
        if pd.isna(question):
            continue
            
        rows.append({
            "row_index": idx + 2, 
            "question": str(question),
            "answer": str(answer) if not pd.isna(answer) else None,
            "q_col_name": q_col,
            "a_col_name": a_col
        })
        
    return rows

def export_excel(original_file_path: str, output_file_path: str, answered_rows: list[dict]):
    """
    Writes the AI-generated answers back into the exact corresponding cells of a copy 
    of the original spreadsheet, preserving formatting.
    """
    wb = openpyxl.load_workbook(original_file_path)
    sheet = wb.active
    
    if not answered_rows:
        wb.save(output_file_path)
        return
        
    a_col_name = answered_rows[0].get("a_col_name")
    
    a_col_idx = None
    for cell in sheet[1]:
        if cell.value == a_col_name:
            a_col_idx = cell.column
            break
            
    if not a_col_idx:
        a_col_idx = 2
        
    for row_data in answered_rows:
        row_idx = row_data["row_index"]
        answer = row_data["answer"]
        if answer:
            sheet.cell(row=row_idx, column=a_col_idx).value = answer
            
    wb.save(output_file_path)
