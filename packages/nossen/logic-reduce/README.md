# @nossen/logic-reduce

Deterministic direct-path reducer for plans, runbooks, and agent handoffs.

It takes a noisy path, removes known dead ends, and keeps safety checks such as
preflight, auth review, tests, audits, backups, and rollback notes.

## Install

```powershell
npm install @nossen/logic-reduce
```

## Use

```js
const { logicReduce, formatReducedPlan } = require('@nossen/logic-reduce');

const result = logicReduce('scan repo + retry broken deploy + patch exact file + run targeted test', {
  objective: 'Fix the failing route'
});

console.log(formatReducedPlan(result));
```

## CLI

```powershell
nossen-logic-reduce --objective "Fix route" --steps "scan repo + retry timeout deploy + patch exact file + run targeted test"
nossen-logic-reduce --json --steps "A + timeout retry + verify auth + C"
```

## Safety

This package does not read secrets, environment variables, or local files. It is
a pure reducer over provided text/step data.

Support is voluntary: https://funesterie.me/contact/
