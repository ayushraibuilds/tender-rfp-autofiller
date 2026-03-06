import requests
import pandas as pd
import os

API_URL = "http://localhost:8001/api/infosec/process-excel"
TEST_FILE = "test_questionnaire.xlsx"
OUTPUT_FILE = "answered_test_questionnaire.xlsx"
WORKSPACE_ID = "test_workspace_123"

def extract_answer_col(df: pd.DataFrame) -> str:
    for col in df.columns:
        col_str = str(col).lower()
        if "answer" in col_str or "response" in col_str:
            return col
    # Fallback to second column if exists
    if len(df.columns) > 1:
        return df.columns[1]
    return None

def test_pipeline():
    print(f"Starting Integration Test against {API_URL}...")
    
    if not os.path.exists(TEST_FILE):
        print(f"❌ Error: Test file '{TEST_FILE}' not found.")
        print(f"Please create a mock '{TEST_FILE}' file in this directory with 'Question' and 'Answer' columns.")
        return

    print(f"1. Sending '{TEST_FILE}' to the FastAPI endpoint...")
    
    with open(TEST_FILE, "rb") as f:
        files = {"file": (TEST_FILE, f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"workspaceId": WORKSPACE_ID}
        
        try:
            response = requests.post(API_URL, files=files, data=data)
        except requests.exceptions.ConnectionError:
            print(f"❌ Error: Could not connect to {API_URL}.")
            print("Is the FastAPI server running?")
            return

    # 1. Verify HTTP Status Code
    if response.status_code != 200:
        print(f"❌ Test Failed: Expected HTTP 200, got {response.status_code}")
        print(f"Response: {response.text}")
        return
        
    print("✅ HTTP 200 OK received.")

    # 2. Save the returned file
    with open(OUTPUT_FILE, "wb") as f:
        f.write(response.content)
        
    print(f"✅ Saved response to '{OUTPUT_FILE}'.")

    # 3. Use pandas to assert the "Answer" column is no longer completely empty
    print("2. Verifying the filled Excel file...")
    try:
        df = pd.read_excel(OUTPUT_FILE)
    except Exception as e:
        print(f"❌ Test Failed: Could not read the returned Excel file. Error: {e}")
        return

    answer_col = extract_answer_col(df)
    
    if not answer_col:
        print("❌ Test Failed: Could not identify an 'Answer' or 'Response' column in the returned file.")
        return
        
    # Check if all answers are empty
    # df[answer_col].dropna() removes NaN values. If the result is empty, no answers were generated.
    valid_answers = df[answer_col].dropna()
    
    # We also check for empty strings just in case
    valid_answers = valid_answers[valid_answers.astype(str).str.strip() != ""]
    
    if len(valid_answers) == 0:
        print("❌ Test Failed: The Answer column is completely empty. No AI responses were generated.")
    else:
        print(f"✅ Success! Found {len(valid_answers)} populated answers in column '{answer_col}'.")
        print("\n--- Sample Answers ---")
        for i, val in enumerate(valid_answers.head(3)):
            print(f"{i+1}. {str(val)[:100]}...")
        print("----------------------\n")
        print("🎉 Integration Test Passed!")

if __name__ == "__main__":
    test_pipeline()
