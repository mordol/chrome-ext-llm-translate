# PoC 결과 기록: LLM CLI 기반 웹 페이지 단락 번역 extension

PoC에서 확인하려던 질문(Q1~Q4)별 결과입니다. 프로젝트 개요와 설치 방법은 [README.md](README.md)를 참고하세요.

기록일: 2026-10-21. 환경: Dia(현재 Chromium **155**.0.8059.80), node v26.10.0(`/opt/homebrew/bin/node`), claude 2.1.286, codex-cli 0.159.2, cursor-agent 2026.10.19.

## 구성물

| 경로 | 내용 |
|---|---|
| `extension/` | MV3 extension. manifest `key`로 ID 고정(`mdnkgmlieapipiojgefbbmjbafdebhgg`). popup에서 번역 시작·표시 모드 전환, content script는 필요할 때만 주입 |
| `host/host.js` | Native Messaging host. `echo`, `translate`(묶음 + 스트리밍), `cancel` 처리. 로그는 `$TMPDIR/llm-translate-host.log` |
| `scripts/install-host.sh` | node 절대 경로를 넣은 `host/run-host.sh`를 만들고 Dia 폴더에 host manifest 설치 |
| `scripts/nm-client.js`, `scripts/bench.js` | 브라우저 없이 host를 띄워 시험·측정하는 도구. 측정 결과 누적: `bench-results.jsonl` |
| `keys/extension-key.pem` | extension 개인 키(git 제외) |

## Q1. Dia Native Messaging — **통과**

- 사용자가 Dia에서 확인(2026-10-21): extension → service worker → host → claude 경로로 번역이 정상 동작함.

- host 자체는 브라우저와 같은 방식(최소 환경, 길이 4바이트 + JSON)으로 echo 성공: 약 0.3초(node 시작 포함).
- host manifest 설치 완료: `~/Library/Application Support/Dia/User Data/NativeMessagingHosts/com.mordol.llm_translate.json`
- Dia 확인 절차:
  1. `dia://extensions`(또는 `chrome://extensions`)에서 개발자 모드를 켜고 `extension/` 폴더를 압축해제 로드
  2. ID가 `mdnkgmlieapipiojgefbbmjbafdebhgg`인지 확인
  3. "service worker" 링크로 콘솔을 열어 `await echo('hi')` 실행 → `{type:'echo', payload:'hi', ...}`가 오면 성공

## Q2. 도구 없이 안전하게 실행 — Claude 통과, codex 조건부, cursor는 권한 파일이 있어야 통과

공통 시험 방법: 빈 임시 폴더에 canary 파일을 두고 (a) 페이지 문장 형태의 인젝션, (b) **정상 지시로 직접** "ls / cat / 파일 생성"을 요청. (b)는 모델이 지시를 무시한 것인지, 실제로 도구가 없는 것인지를 구분하기 위한 시험입니다.

| CLI | 사용 옵션 | 결과 |
|---|---|---|
| claude | `-p --tools "" --safe-mode --strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence --system-prompt …` | init 이벤트에서 `tools=[]`, `mcp_servers=[]`. 인젝션은 번역만 됨. 파일 생성·canary 노출 없음. **통과** |
| codex | `exec --ignore-user-config --ignore-rules --ephemeral --sandbox read-only -c approval_policy="never" -c web_search="disabled" --disable shell_tool,unified_exec,apps,plugins,…,code_mode_host` | 직접 지시해도 shell 실행 불가, 파일 생성 불가. `apply_patch` 등은 code mode(`functions.exec`)를 거쳐야 하는데 host를 꺼서 실패(fail closed). 단, `collaboration.*`(spawn_agent 등)는 끌 방법을 찾지 못함(모델이 스스로 보고한 목록 기준). **조건부** |
| cursor-agent | `-p --trust --mode ask --sandbox enabled` | **기본 옵션만으로는 실패.** ask 모드여도 `ReadFile`로 작업 폴더 밖의 파일까지 읽음 → 읽은 내용이 "번역문"으로 페이지 DOM에 들어가면 페이지 JS가 가져갈 수 있음 |
| cursor-agent | 위 옵션 + 작업 폴더에 `.cursor/cli.json`(Read/Write/Shell/Mcp 전부 deny) | `ReadFile`(폴더 안팎 모두) → `Permission denied`, Shell → `permissionDenied`. **통과**. Glob/rg는 따로 시험하지 않음 |

발견한 제약:
- 실행 환경에 `USER`가 없으면 claude가 `Not logged in`으로 실패함(`env -i HOME=… PATH=…`만으로 시험했을 때). 브라우저가 띄운 프로세스는 launchd 환경을 물려받으므로 실제로는 문제가 없을 것으로 보이지만, Dia에서 확인이 필요함.
- `--bare`(claude)는 OAuth를 쓰지 않아 구독 로그인으로는 사용할 수 없음.
- codex는 실행 오류(예: 지원하지 않는 모델)를 stderr가 아니라 stdout JSON(`turn.failed`)으로 보냄. 처음에는 host가 이 메시지를 놓쳐 빈 오류만 전달했고, 지금은 이 이벤트를 읽도록 고침. 예: `luna` 모델 → "The 'luna' model is not supported when using Codex with a ChatGPT account."
- codex는 stdin이 열려 있으면 추가 입력을 기다리며 멈춤 → stdin을 반드시 닫아야 함.
- cursor-agent는 `--trust`가 없으면 workspace trust 확인에서 실패함(`-f`/`--yolo`는 명령 실행 허용이므로 사용하지 않음).
- 읽기 도구도 위험함: 로컬 파일 내용이 번역문으로 출력되면 페이지로 유출될 수 있음. "쓰기·실행 차단"만으로는 부족하고 **읽기도 막아야 함**.

## Q3. 스트리밍 + 묶음 처리 — **통과** (Dia에서 claude sonnet으로 확인)

- 출력 형식 `[id] 번역문`을 한 줄씩 파싱해서, 줄이 끝날 때마다 `{type:'para'}`로 전송함. 6~20개 묶음에서 누락 0건.
- claude: `stream-json --include-partial-messages`의 text delta로 단락별 점진 도착 확인(6단락: 2.3초 → 6.4초 사이에 순차 도착).
- cursor: `--stream-partial-output`의 delta로 점진 도착함. 마지막에 전체 메시지가 한 번 더 오므로 중복 제거가 필요함.
- codex: `exec --json`에 delta 이벤트가 없어서 **묶음이 끝날 때 한꺼번에 도착함**. 점진 표시를 하려면 묶음을 작게 잡는 수밖에 없음.
- extension(popup → content script → service worker → host)을 Dia에서 실행해 정상 동작을 확인함.
  - 화면 아래 한 화면 분량까지(IntersectionObserver) 묶어서 요청함.
  - 번역문은 원문 바로 뒤에 같은 태그로 삽입함. `td`/`th`는 셀 안에 삽입함.
  - 표시 모드는 `<html>` 클래스로 전환함.

## Q4. 속도 — 영어 단락 20개, 묶음은 순차 처리 (`scripts/bench.js`)

`첫 단락` = 첫 묶음을 요청한 뒤 첫 단락이 표시될 때까지 걸린 시간. `단락당` = 20단락 전체 시간 ÷ 20. 비용은 claude가 보고한 API 환산 금액이며, 구독 사용 시 실제 청구액과 다릅니다.

| CLI / 모델 | 묶음 1 (첫 단락 / 단락당) | 묶음 5 | 묶음 10 | 묶음 20 | 20단락 비용(묶음 20) |
|---|---|---|---|---|---|
| claude / opus-5-5 (기본) | 4.3s / 4.4s | 2.8s / 1.3s | 2.8s / 0.90s | 2.8s / 0.76s | $0.046 |
| **claude / sonnet-5-5** | 6.0s / 4.2s | **1.9s / 1.2s** | 3.4s / 0.76s | 2.3s / **0.57s** | $0.023 |
| claude / haiku-4-5 (thinking 켜짐, 수정 전) | 7.4s / 7.8s | 10.0s / 5.1s | 13.5s / 2.0s | 33.7s / 2.2s | $0.032 |
| claude / haiku-4-5 (thinking 끔) | — | — | 2.0s / 0.82s | 2.1s / 0.65s | $0.0095 |
| codex / 기본 | 6.0s / 8.1s | 10.0s / 2.4s | 16.8s / 1.9s | 26.7s / 1.4s | — |
| cursor / GPT-5.4 Mini Low (기본) | 9.7s / 16.9s | 7.8s / 2.0s | 8.3s / 1.1s | 7.7s / 0.59s | — |

- CLI 시작 오버헤드(프로세스 실행 → init 이벤트): claude 약 0.23초, cursor 약 4.3~4.6초. codex의 init 기준 측정값(약 0.07초)은 시작 시간으로 보기 어려움.
- 단락마다 CLI를 실행하는 방식(묶음 1)은 모든 CLI에서 단락당 4초 이상이라 쓸 수 없음. 묶음 10~20이면 단락당 0.6~0.9초.
- haiku가 느렸던 원인은 첫 출력 전에 thinking에 약 9초를 쓰는 것이었음(stream 이벤트로 확인). `--settings '{"alwaysThinkingEnabled":false}'`로 끄면 첫 출력이 약 1.3초로 줄어듦. sonnet은 원래 thinking을 쓰지 않아서 이 설정을 줘도 차이가 없음(첫 출력 1.6~1.9초). host의 claude 어댑터에 항상 넣도록 바꿈.
- 측정은 한 번씩만 했고, 일부는 다른 측정과 동시에 실행했으므로 수치는 대략적인 값임.

## 현재까지의 결론과 다음 단계

- 권장 조합: **claude + sonnet 또는 haiku(thinking 끔), 묶음 10 안팎**. 첫 단락 2~3초, 단락당 0.6~0.8초, 도구가 실제로 0개임을 init 이벤트로 확인 가능. haiku는 비용이 sonnet의 절반 이하이므로 번역 품질 비교 후 결정.
- cursor는 권한 파일이 필요하고 시작이 4초 이상 걸림. codex는 스트리밍이 없고 끌 수 없는 도구가 남음. 둘 다 보조 선택지로 둠.
- 남은 확인: sonnet과 haiku의 번역 품질 비교.
