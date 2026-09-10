# DopeDB 브랜드 자산

[`dopedb-icon.svg`](./dopedb-icon.svg)가 승인된 브랜드의 단일 원본이다.
좁은 D와 −24° 행성 고리, 앞쪽 위성 점의 비율을 유지한다. 타일 배경은 기존
`#151a16`, 마크는 `#ccf36b`이며 모서리 바깥은 투명하다.

## 생성 및 검증

저장소 루트에서 실행한다. macOS `iconutil`, Python 3 + Pillow,
`pnpm --dir site install --frozen-lockfile`로 설치한 사이트 의존성이 필요하다.
SVG 렌더러는 Next의 선언된 Sharp 의존성을 사용하며 런타임 앱에 추가하지 않는다.

```sh
pnpm icons
pnpm icons --check
```

생성기는 SVG를 직접 렌더링하고 같은 도형에서 배경 없는 React graphic도 생성한다.
모든 파일을 임시 디렉터리에 완성한 뒤 변경된 생성물만 복사한다. `--check`는
저장소를 변경하지 않고 누락·불일치 시 실패한다. 도형 수정은 원본 SVG에서만 하고
생성된 파일이나 공용 graphic을 따로 수정하지 않는다.

## 사용처

| 사용처 | 생성물 / 소비자 |
| --- | --- |
| 한·영 README | 원본 `assets/brand/dopedb-icon.svg` |
| Desktop 헤더·Workspace selector | `src/design-system/components/DopeDBMark` 기본 24px·compact 20px → 생성된 `DopeDBMarkGraphic` |
| 소개 사이트 헤더·데모·설치 안내 | `site/app/DopeDBMark` → 같은 graphic |
| Workspace 로그인·기기 승인·초대·설정·Article | `workspace-cloud/app/components/Brand` → 같은 graphic |
| Desktop 브라우저 탭·Tauri bundle·Dock·Windows installer | `src-tauri/icons/`의 PNG 4개, ICO, ICNS |
| 소개 사이트 탭·홈 화면 | `site/public/`의 SVG, ICO, 48/180/192/512px PNG |
| 약관·개인정보 문서·OAuth 업로드 | `site/public/oauth-logo-120.png` |
| Workspace 탭·홈 화면 | `workspace-cloud/app/icon.svg`, `favicon.ico`, `apple-icon.png` |

총 17개 생성물(공용 TSX 1개, SVG 2개, PNG 10개, ICO 3개, ICNS 1개)을 검증한다.
inline 마크는 각 화면의 semantic `currentColor`를 사용해 라이트·다크 테마에
맞추며, 각 앱의 React `useId()`가 mask 참조를 분리한다.

## 배포 경계

소스 교체만으로 설치된 앱, 공개 사이트나 외부 OAuth 콘솔에 업로드한 로고가
바뀌지는 않는다. 앱은 다음 설치 파일 빌드·릴리스, 웹은 각 앱의 배포가 필요하다.
외부 Google/GitHub 등의 앱 등록에 직접 올린 이미지는 해당 계정 소유자가
위 OAuth PNG로 교체해야 한다. 이 생성 명령은 배포하거나 외부 설정을 바꾸지 않는다.
브라우저·OS의 아이콘 캐시가 이전 이미지를 잠시 유지할 수도 있다.

`site/public/dopedb-desktop-0.4.21*.png`와 `audits/`의 실제 화면 캡처는 해당
버전·시점의 기록이므로 덧그리지 않는다. 새 UI 캡처가 필요하면 변경된 앱에서
다시 촬영한다. DB 엔진·Claude·Codex 등 외부 제품 로고도 교체 대상이 아니다.
