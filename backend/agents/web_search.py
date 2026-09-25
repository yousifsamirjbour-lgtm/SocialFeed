
from langchain_tavily import TavilySearch
from langgraph.prebuilt import create_react_agent
from langchain_groq import ChatGroq

def get_search_agent():
    """Initializes and returns the LangGraph search agent."""
    tools = [TavilySearch(max_results=3)]
    
    llm = ChatGroq(model="openai/gpt-oss-20b", temperature=0)    
    return create_react_agent(
        llm,
        tools,
        prompt=(
            "Always include a 'Sources' section at the end with active, clickable "
            "Markdown links formatted as [Source Name](URL) using the actual URLs "
            "returned by Tavily. Never list sources as plain text."
        ),
    )