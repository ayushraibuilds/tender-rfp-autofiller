import os
import shutil
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
import uvicorn

from excel_processor import process_excel_upload, export_excel
from infosec_graph import infosec_graph

app = FastAPI(title="InfoSec Auto-Responder API")

UPLOAD_DIR = "/tmp/infosec_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/api/infosec/process-excel")
async def process_excel(
    workspaceId: str = Form(...),
    file: UploadFile = File(...)
):
    if not file.filename.endswith('.xlsx'):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")
        
    original_file_path = os.path.join(UPLOAD_DIR, file.filename)
    output_file_path = os.path.join(UPLOAD_DIR, f"filled_{file.filename}")
    
    with open(original_file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        # 1. Parse Excel data
        rows = process_excel_upload(original_file_path)
        if not rows:
            raise HTTPException(status_code=400, detail="Could not detect questions in the Excel file.")
            
        # 2. Run LangGraph Pipeline
        # We invoke the graph logic
        state = {
            "questionnaire_rows": rows,
            "workspace_id": workspaceId
        }
        
        result_state = infosec_graph.invoke(state)
        answered_rows = result_state["questionnaire_rows"]
        
        # 3. Export to an Excel file with preserved formatting
        export_excel(original_file_path, output_file_path, answered_rows)
        
        return FileResponse(
            output_file_path,
            filename=f"filled_{file.filename}",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
