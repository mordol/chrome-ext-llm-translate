# LLM Translate (PoC)

PC에 설치된 LLM CLI(Claude Code, Codex, Cursor Agent)로 현재 웹 페이지를 **단락 단위로 번역**하고, 번역이 끝나는 대로 **점진적으로 표시**하는 Chromium extension입니다. 표시 모드는 원본 / 원본 + 번역 / 번역 세 가지입니다.

현재는 PoC 단계입니다. 검증 결과와 측정값은 [POC_RESULTS.md](POC_RESULTS.md)에 있습니다. macOS의 Dia(Chromium 155)에서 확인했습니다.

## 구조

```
웹 페이지 (content script)       ← 단락 추출, 번역 결과 삽입, 표시 모드 전환
   ↕ chrome.runtime 메시지
extension (service worker)       ← 단락 묶음 전송, 결과 캐시
   ↕ Native Messaging (stdin/stdout, 길이 4바이트 + JSON)
host (Node, host/host.js)        ← 사용자 PC에 설치, 브라우저가 실행
   ↕ 자식 프로세스
LLM CLI (claude -p / codex exec / cursor-agent -p)
```

| 경로 | 내용 |
|---|---|
| `extension/` | MV3 extension. manifest `key`로 ID를 고정(`mdnkgmlieapipiojgefbbmjbafdebhgg`) |
| `host/host.js` | Native Messaging host. CLI별 실행 옵션과 출력 파서(adapter) 포함 |
| `scripts/install-host.sh` | host 실행 wrapper를 만들고 host manifest를 브라우저 폴더에 설치 |
| `scripts/nm-client.js` | 브라우저 없이 host에 메시지 하나를 보내 보는 도구 |
| `scripts/bench.js` | 묶음 크기별 속도 측정. 결과는 `bench-results.jsonl`에 누적 |

### 동작 방식

- **단락 추출:** `p`, `li`, `h1~h6`, `blockquote`, `td`, `th`, `dd`, `dt`, `figcaption`의 텍스트를 대상으로 합니다. `pre`/`code`, 메뉴, 입력창, 숨김 요소는 제외합니다.
- **보이는 부분부터:** IntersectionObserver로 화면과 그 아래 한 화면 분량에 들어온 단락만 차례로 요청합니다.
- **묶어서 보내기:** CLI는 실행할 때마다 시작 비용이 있으므로 단락 여러 개를 한 번에 보냅니다. 출력은 `[id] 번역문` 형식으로 받고, 한 줄이 끝날 때마다 페이지에 표시합니다.
- **삽입과 표시 모드:** 번역문은 원문 바로 뒤에 같은 태그로 넣습니다. 표 셀(`td`/`th`)은 셀 안에 넣습니다. 표시 모드는 `<html>`의 CSS 클래스만 바꿔 전환하므로 원래 내용은 바꾸지 않습니다.

## 설치 (개발용)

### 지원 범위

- **OS:** macOS만 지원합니다.
  - 설치 스크립트는 macOS 경로만 알고 있습니다.
  - Windows는 host를 레지스트리로 등록하고, Linux는 폴더 위치가 달라서 이 스크립트로는 설치되지 않습니다.
- **브라우저:** 스크립트가 host manifest를 자동으로 설치하는 곳은 아래 두 곳뿐입니다.
  - Dia: `~/Library/Application Support/Dia/User Data/NativeMessagingHosts/` (항상 설치)
  - Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (`~/Library/Application Support/Google/Chrome`이 있을 때만)
  - 다른 Chromium 브라우저에서 쓰려면, 그 브라우저의 사용자 데이터 폴더 아래 `NativeMessagingHosts/`에 같은 manifest를 직접 복사해야 합니다. 동작 확인은 Dia에서만 했습니다.
- **Node:** 설치할 때 `node`가 `PATH`에 있거나 `NODE_BIN`으로 지정되어 있어야 합니다.
  - 둘 다 없으면 스크립트가 **아무 메시지 없이 exit 1로 끝납니다.**
  - 동작 확인은 Node v26에서 했습니다.
- **LLM CLI:** 쓰려는 CLI를 설치하고 **터미널에서 한 번 로그인**해 두어야 합니다. host는 로그인 상태를 그대로 쓸 뿐, 로그인을 대신 해 주지 못합니다.
  - 기본 경로: `~/.local/bin/claude`, `~/.local/bin/codex`, `~/.local/bin/cursor-agent`

### 설치 순서

1. clone:
   ```sh
   git clone git@github.com:mordol/chrome-ext-llm-translate.git
   cd chrome-ext-llm-translate
   ```
2. host 설치:
   ```sh
   ./scripts/install-host.sh
   # node가 PATH에 없으면: NODE_BIN=/path/to/node ./scripts/install-host.sh
   ```
   - 스크립트는 `host/run-host.sh`(wrapper)를 만들고 위 브라우저 폴더에 `com.mordol.llm_translate.json`을 설치합니다.
   - 브라우저가 실행한 host는 셸의 `PATH`를 물려받지 않습니다. 그래서 node의 절대 경로를 wrapper에 고정합니다.
   - CLI가 기본 경로에 없으면 `LLM_TRANSLATE_CLAUDE`, `LLM_TRANSLATE_CODEX`, `LLM_TRANSLATE_CURSOR` 환경 변수로 지정합니다.
3. 브라우저 확장 관리 페이지(Dia: `dia://extensions`, Chrome: `chrome://extensions`)에서 개발자 모드를 켜고, `extension/` 폴더를 압축해제 로드합니다. 확장 ID가 `mdnkgmlieapipiojgefbbmjbafdebhgg`인지 확인합니다.
4. 연결 확인: 확장의 service worker 콘솔에서 `await echo('hi')`를 실행합니다. `{type:'echo', ...}`가 돌아오면 성공입니다.

### 확장 ID와 키

- 확장 ID는 `extension/manifest.json`의 `key`(**공개 키**)로 정해집니다. 이 값이 repo에 들어 있으므로, 어느 PC에서 clone해도 ID가 같습니다.
- host manifest의 `allowed_origins`도 이 ID 하나로 설정됩니다(`install-host.sh`의 `EXTENSION_ID`).
- **개인 키(`.pem`)는 repo에 없고, 설치나 사용에도 필요하지 않습니다.** 같은 ID로 `.crx` 패키지를 직접 만들 때만 필요합니다.
- 키를 새로 만들면 ID가 바뀝니다. 그때는 `manifest.json`의 `key`와 `install-host.sh`의 `EXTENSION_ID`를 함께 바꾸고 설치 스크립트를 다시 실행해야 합니다.

### 설치 스크립트를 다시 실행해야 하는 경우

wrapper와 host manifest에는 **clone 위치와 node 경로가 절대 경로로 고정**됩니다. 다음 경우에는 `./scripts/install-host.sh`를 다시 실행하세요.

- repo 폴더를 옮기거나 이름을 바꿨을 때
- node 경로가 바뀌었을 때(예: nvm으로 버전을 바꾼 경우)

### 제거

```sh
rm "$HOME/Library/Application Support/Dia/User Data/NativeMessagingHosts/com.mordol.llm_translate.json"
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.mordol.llm_translate.json"
```

그다음 브라우저에서 확장을 제거합니다.

## 사용

popup에서 CLI·모델·대상 언어·묶음 크기를 고르고 **Translate this page**를 누릅니다. 진행 상황과 마지막 묶음의 측정값은 페이지 오른쪽 아래에 표시됩니다.

모델 칸은 CLI에서 가져온 목록을 자동완성으로 보여 줍니다. 목록에 없는 ID도 직접 입력할 수 있고, 모델 값은 CLI별로 따로 기억합니다. 목록은 저장해 두며 ↻ 버튼으로 다시 가져옵니다.

| CLI | 목록 출처 |
|---|---|
| claude | 목록 명령이 없어서 도움말에 안내된 별칭(`fable`, `opus`, `sonnet`, `haiku`)을 고정으로 사용 |
| codex | `codex debug models`에서 노출 여부가 `list`인 모델. 디버그용 명령이라 버전에 따라 형식이 바뀔 수 있음 |
| cursor-agent | `cursor-agent models` 출력 |

모델 ID는 화면에 보이는 이름과 다를 수 있습니다. 예를 들어 codex의 "GPT-6-Luna"는 `gpt-6-luna`입니다.

- 권장 설정: claude + `sonnet` 또는 `haiku`, 묶음 10 안팎. 근거는 [POC_RESULTS.md](POC_RESULTS.md)의 Q4를 참고하세요.
- host 로그: `$TMPDIR/llm-translate-host.log`
- `host/host.js`를 고친 뒤에는 확장을 새로고침해야 새 host 프로세스가 실행됩니다.

## 보안

웹 페이지 내용이 에이전트형 CLI에 그대로 입력되므로, 페이지에 숨겨진 지시문(프롬프트 인젝션)이 가장 큰 위험입니다. 파일 쓰기와 명령 실행만이 아니라 **파일 읽기도 막아야 합니다.** 로컬 파일 내용이 "번역문"으로 출력되면 페이지에 삽입되고, 페이지 JS가 그것을 읽어 갈 수 있기 때문입니다.

대응:
- CLI의 도구를 모두 끄고, 매번 새로 만든 빈 임시 폴더에서 실행합니다.
- 프롬프트에 페이지 텍스트는 번역할 데이터일 뿐이라고 명시합니다.
- host manifest의 `allowed_origins`를 이 확장 ID 하나로 제한합니다.

CLI별 도구 차단 방법과 시험 결과:

| CLI | 차단 방법 | 상태 |
|---|---|---|
| claude | `--tools ""`, `--safe-mode`, `--strict-mcp-config`, `--setting-sources ""` | 도구 0개(init 이벤트로 확인) |
| codex | `--ignore-user-config`, `--sandbox read-only`, shell·code mode 등의 feature 비활성 | shell과 쓰기는 막힘. `collaboration.*` 도구는 끄지 못함 |
| cursor-agent | `--mode ask` + 작업 폴더의 `.cursor/cli.json`에서 Read/Write/Shell/Mcp 전부 deny | 권한 파일이 없으면 ask 모드에서도 임의 파일을 읽을 수 있음 |

## 알려진 제약

- **호스트 설치:** 웹 스토어로는 extension만 배포되므로 host와 그 manifest는 설치 스크립트로 따로 설치해야 합니다.
- **메시지 크기:** host가 브라우저로 보내는 메시지는 1개당 최대 1MB입니다. 그래서 결과를 단락 단위로 보냅니다.
- **스트리밍:** codex는 출력이 끝나야 묶음 전체가 한꺼번에 도착합니다.
- **시작 시간:** cursor-agent는 시작에 4초 이상 걸립니다.
- **번역 한 번 = CLI 실행 한 번:** 묶음마다 CLI 구독 사용량이나 API 비용이 듭니다. 보이는 부분 우선 번역과 service worker 메모리 캐시로 줄입니다.
- **동적 페이지 (미구현):**
  - 나중에 추가되는 단락은 감지하지 않습니다(MutationObserver).
  - React 등이 화면을 다시 그려 지운 번역도 다시 넣지 않습니다.
- **표 셀:** `td`/`th`는 번역문을 셀 안에 넣으므로 "번역" 모드에서도 원문이 함께 보입니다.
