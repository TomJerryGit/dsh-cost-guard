# @tomjerrygit/dsh-cost-guard

Token cost guard for DeepSeek Harness. Independent of the management-console data file.

## Features

- Token and cost analytics from DSH session projections
- Daily/monthly budgets with 80% warning and 100% auto savings mode
- Auto savings mode with a concise prompt, model candidate discovery, and configurable thrift workspace list
- Compaction and tool-result-pruner status
- Current context pressure and estimated compressible tokens
- 30-day actual vs no-cache baseline cost trend
- Workspace cost ranking and session ranking

## Install

```sh
dsh plugin --profile web add @tomjerrygit/dsh-cost-guard
```

Market index:

```text
https://tomjerrygit.github.io/dsh-cost-guard/index.json
```

## Usage

Open **Cost Guard** in the left sidebar. Set daily/monthly budgets, enable savings mode, and choose a savings model. Savings mode applies to new sessions; the current session receives concise prompt guidance and compaction continues automatically.
