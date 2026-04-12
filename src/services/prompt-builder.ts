/**
 * Builds the system prompt for Claude CLI that instructs it to orchestrate
 * an HF coding model. Claude CLI acts as the "hands" — calling the HF model
 * via curl and executing its tool_calls using built-in tools.
 */

const CODING_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description:
        'Create a new file with the given content. Use this for creating source code, HTML, CSS, config files, etc.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to create (relative to workspace root)' },
          content: { type: 'string', description: 'Full content of the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace the entire content of an existing file. Use this for modifying source code, updating configs, etc.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          new_content: { type: 'string', description: 'New full content of the file' },
        },
        required: ['path', 'new_content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the content of a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Execute a shell command and return its output. Use for installing packages, running tests, starting servers, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories at the given path.',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directory path to list (defaults to ".")' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a pattern in files recursively.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (grep regex)' },
          directory: { type: 'string', description: 'Directory to search in (defaults to ".")' },
        },
        required: ['pattern'],
      },
    },
  },
]

export function buildOrchestratorPrompt(
  task: string,
  hfUrl: string,
  hfModel: string,
  hfApiKey: string | undefined,
): string {
  const authHeader = hfApiKey ? `-H "Authorization: Bearer ${hfApiKey}" ` : ''

  const toolsJson = JSON.stringify(CODING_TOOLS, null, 2)

  return `You are an orchestrator that uses an external AI coding model to solve programming tasks.
Your job is to call the AI model, execute its tool calls, and loop until the task is done.

## External Model
- URL: ${hfUrl}
- Model: ${hfModel}

## Available Coding Tools (OpenAI function format)
These are the tools the external model can request. You will execute them.

\`\`\`json
${toolsJson}
\`\`\`

## Instructions

### Step 1: Send the task to the external model
Use Bash to make a curl request:

\`\`\`bash
curl -s -X POST "${hfUrl}" \\
  ${authHeader}-H "Content-Type: application/json" \\
  -d '<JSON_PAYLOAD>'
\`\`\`

The JSON payload for the FIRST request should be:
\`\`\`json
{
  "model": "${hfModel}",
  "messages": [
    {"role": "user", "content": "<THE_TASK>"}
  ],
  "tools": <CODING_TOOLS_ARRAY>,
  "tool_choice": "auto"
}
\`\`\`

### Step 2: Parse the response
The response will be an OpenAI Chat Completions response. Extract:
- \`choices[0].message.content\` — any text the model wants to say
- \`choices[0].message.tool_calls\` — array of tool calls to execute
- \`choices[0].finish_reason\` — "stop" means done, "tool_calls" means execute and continue

### Step 3: Execute tool calls
For each tool call in the response, execute it using YOUR built-in tools:

- **create_file(path, content)** → Use the Write tool to create the file at the specified path
- **edit_file(path, new_content)** → Use the Write tool to overwrite the file with new content
- **read_file(path)** → Use the Read tool to read the file and return its content
- **run_command(command)** → Use the Bash tool to execute the command and capture stdout+stderr
- **list_files(directory)** → Use the Bash tool: \`ls -la <directory>\`
- **search_files(pattern, directory)** → Use the Bash tool: \`grep -r "<pattern>" <directory>\`

### Step 4: Send tool results back to the model
Make another curl request with the full conversation history including tool results.
The messages array should include:
1. The original user message
2. The assistant message (with tool_calls) from the model's response
3. For each tool call, a tool result message:
   \`\`\`json
   {"role": "tool", "tool_call_id": "<tool_call_id>", "content": "<result_string>"}
   \`\`\`

### Step 5: Repeat
Continue this loop (Steps 2-4) until the model returns \`finish_reason: "stop"\` (no more tool calls).

### Step 6: Summarize
When the model is done, summarize what was built:
- List all files that were created or modified
- Describe the overall solution
- Note any commands that were run and their results

## IMPORTANT RULES
1. You MUST faithfully execute every tool call the model requests — do not skip or modify them.
2. Always send the FULL conversation history in each curl request to the model (all messages so far).
3. If a tool call fails, send the error message back as the tool result — let the model decide how to handle it.
4. If the model requests a tool that does not exist, send back an error: "Unknown tool: <name>".
5. Do NOT add your own creative decisions — the external model is the brain, you are the hands.
6. Maximum loop iterations: 50. If you reach 50, stop and summarize what was accomplished so far.
7. When constructing curl payloads, properly escape all JSON strings (especially file contents with newlines, quotes, etc). Use a here-document or temporary file for large payloads.

## THE TASK
${task}`
}
