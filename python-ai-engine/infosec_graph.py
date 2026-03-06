import sqlite3
import json
import os
import numpy as np
from typing import TypedDict, List, Dict, Any
from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'server', 'data', 'knowledge.db')

class InfoSecGraphState(TypedDict):
    questionnaire_rows: List[Dict]
    workspace_id: str

def get_db_connection():
    return sqlite3.connect(DB_PATH)

def retrieve_context(workspace_id: str, query: str, top_k: int = 3) -> str:
    """
    Retrieve context from the SQLite database.
    Since we don't have direct access to the exact embedding logic from the Node.js side 
    without duplicating the fallback hashing or hitting external APIs,
    we'll use a semantic search approximation or simply fetch relevant chunks for the workspace.
    For MVP, we query FTS if available or fallback to fetching all chunks of the workspace.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Clean query to avoid breaking FTS syntax
    safe_query = ''.join(e for e in query if e.isalnum() or e.isspace())
    
    try:
        cursor.execute('''
            SELECT content FROM chunks_fts 
            WHERE chunks_fts MATCH ? AND company_id = ?
            LIMIT ?
        ''', (safe_query, workspace_id, top_k))
        rows = cursor.fetchall()
        if rows:
            conn.close()
            return "\n\n".join([r[0] for r in rows])
    except sqlite3.Error:
        pass
        
    # Fallback: Just get the first few chunks for the workspace
    cursor.execute("SELECT content FROM chunks WHERE company_id = ? LIMIT ?", (workspace_id, top_k * 2))
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return ""
        
    return "\n\n".join([r[0] for r in rows[:top_k]])

def draft_infosec_responses(state: InfoSecGraphState) -> InfoSecGraphState:
    rows = state["questionnaire_rows"]
    workspace_id = state["workspace_id"]
    
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        llm = ChatOpenAI(model="gpt-4o-mini", api_key=api_key)
    else:
        # Mock LLM for local testing without keys
        class MockLLM:
            def invoke(self, messages):
                class MockResponse:
                    content = "Requires Manual Review"
                return MockResponse()
        llm = MockLLM()
        
    updated_rows = []
    
    for row in rows:
        question = row["question"]
        context = retrieve_context(workspace_id, question)
        
        system_prompt = (
            "You are a Senior Cloud Security Architect perfectly trained in InfoSec questionnaires.\n"
            "Below is context retrieved from our knowledge base.\n"
            "Answer strictly based on retrieved context. If context is missing or irrelevant, output ONLY: 'Requires Manual Review.'\n"
            f"\nContext:\n{context}"
        )
        
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=question)
        ]
        
        response = llm.invoke(messages)
        row["answer"] = response.content.strip()
        updated_rows.append(row)
        
    state["questionnaire_rows"] = updated_rows
    return state

builder = StateGraph(InfoSecGraphState)
builder.add_node("draft_infosec_responses", draft_infosec_responses)
builder.add_edge(START, "draft_infosec_responses")
builder.add_edge("draft_infosec_responses", END)

infosec_graph = builder.compile()
