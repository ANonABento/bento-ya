# Overnight Audit Report
Run directory: ./.overnight-audit/runs/run-20260306-155922
Repository: /Users/bentomac/bento-ya
Profile: balanced
Files scanned: 7
Starting index (resume): 0
Findings: 4
Duration seconds: 7

## Check summary
check\tstatus\tseconds
check	status	seconds
lint	FAIL	4.00
type-check	FAIL	2.00

## Severity summary
severity\tcount
P0	2
P2	2

## Top categories
count\tcategory
2	CONSOLE_STATEMENT
1	CHECK_FAIL_type-check
1	CHECK_FAIL_lint

## Top files
count\tfile
1	src/lib/ipc.ts
1	src/components/panel/agent-panel.tsx
1	CHECK:type-check
1	CHECK:lint
