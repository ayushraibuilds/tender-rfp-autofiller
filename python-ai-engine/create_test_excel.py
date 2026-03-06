import pandas as pd

# Create a simple test questionnaire
data = {
    "ID": [1, 2, 3],
    "Security Question": [
        "How do you handle data encryption at rest?",
        "What is your policy on quantum cryptography?",
        "Do you perform regular penetration testing?"
    ],
    "Answer/Response": ["", "", ""]
}

df = pd.DataFrame(data)
df.to_excel("test_questionnaire.xlsx", index=False)
print("Created test_questionnaire.xlsx")
