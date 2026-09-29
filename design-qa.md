# Design QA — редактирование профиля

Date: 2026-09-28

## Evidence

- Source visual truth: `C:\Users\damik\Downloads\photo_5319034735600279030_y.jpg` (1280 × 900).
- Source copy used for comparison: `C:\Users\damik\OneDrive\Рабочий стол\poplab\assets\qa\profile-reference.jpg`.
- Implementation: `http://localhost:4173/#profile`, captured in Codex in-app browser at a 1280 × 720 CSS viewport with device density 1.
- Combined comparison input: `C:\Users\damik\OneDrive\Рабочий стол\poplab\qa-profile-comparison.html`, presenting the 1280 × 900 source and a live 1280 × 900 implementation frame side by side at 0.5 scale.
- Additional responsive evidence: live implementation at 390 × 844 CSS px.
- State: authenticated profile, saved/default data, light theme.

## Findings

- No actionable P0/P1/P2 differences remain.
- Fonts and typography: Roboto Condensed Variable and Manrope Variable preserve the source hierarchy, weight contrast, wrapping, and compact UI typography.
- Spacing and layout: three-column desktop structure, portrait/form/settings proportions, dividers, field rhythm, and responsive single-column flow match the intended composition. No horizontal overflow was detected.
- Colors and tokens: warm paper surface, black text, red CTA, lime switches, muted labels, and neutral rules remain consistent with the source.
- Image quality: dedicated high-resolution profile portrait is correctly cropped and remains sharp at desktop and mobile sizes. Its exact subject differs from the source photograph; this is an acceptable generated-asset constraint.
- Copy and content: source labels and profile data are preserved. Added helper/status copy is subordinate and supports editing without changing hierarchy.
- Focused regions checked: input validation, language/timezone menus, notification switches, avatar editor, save/cancel state, and the password dialog.

## Comparison history

1. Initial profile-function pass: the disabled saved-state CTA appeared pale pink and materially drifted from the source red action. Classified P2.
2. Fix: retained the active red “Сохранить изменения” CTA in the saved state and moved status feedback to supporting text below it.
3. Post-fix comparison: CTA color, weight, dimensions, and position now align with the source; no further P0/P1/P2 findings.

## Interaction verification

- Required-name and email-format validation with inline errors and focus on the first invalid field.
- Editing name, email, and role; header and profile identity update during editing.
- Language and timezone selection.
- Notification switches included in dirty/save state.
- Local persistence verified after reload; discard restores the last saved snapshot.
- Password dialog rejects mismatched passwords and closes with success feedback for a valid mock submission.
- Avatar picker exposes JPG/PNG/WebP filtering and a 2 MB client-side limit.
- Desktop and mobile layouts verified; zero broken images, zero horizontal overflow, and zero console warnings/errors.

## Follow-up polish

- P3: a production backend will still be needed for real password rotation, remote avatar storage, and cross-device profile persistence.

final result: passed
