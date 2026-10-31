# Исследование SUE_system

Дата: 31.10.2026. Только чтение через GitHub connector; код платформы не изменялся.
Исследован снимок `main`, SHA `e7478f8d0a94da73f552c6173f1c526dc781e3c2`.
Ссылки ниже привязаны к этому снимку; сведения о реальной боевой конфигурации отдельно не проверялись.

## Проверенные источники
- [README.md](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/README.md): оболочка, отдельные сервисы, iframe.
- [CLAUDE.md](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/CLAUDE.md): интеграционные правила, badge, паттерн сопоставления по email.
- [package.json](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/package.json): React 18, Vite 5, keycloak-js 25, Zustand 4, react-rnd, lucide-react (это зависимости платформы, не выбранные версии TP_Approval).
- [AppFrame.jsx](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/src/components/AppFrame.jsx): точный обмен сообщениями.
- [AuthProvider.jsx](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/src/auth/AuthProvider.jsx), [keycloak.js](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/src/auth/keycloak.js): realm-роли, обновление токена, dev bypass.
- [apps.js](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/src/config/apps.js): реестр, фильтрация иконок по ролям.
- [useAppBadges.js](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/src/hooks/useAppBadges.js): запросы badge.
- [useDesktopStore.js](https://github.com/ashinoff/SUE_system/blob/e7478f8d0a94da73f552c6173f1c526dc781e3c2/src/store/useDesktopStore.js): локальный массив уведомлений.

## Контракт и обнаруженные ограничения
1. TP_Approval устанавливает listener, затем отправляет родителю `{type:'app-ready'}` с точным targetOrigin. Оболочка отвечает `{type:'platform-auth',token}`. Проверять одновременно `event.origin` по allowlist и `event.source === window.parent`; проверять форму сообщения. Токен хранить в памяти, не URL/localStorage.
2. Оболочка также отправляет токен на iframe onLoad. Listener готовности пересоздаётся при смене токена, но немедленная отправка обновлённого JWT только из-за его смены отсутствует. TP_Approval должен повторять app-ready перед истечением/после 401 с ограничением частоты; бесконечные повторы запрещены. Не использовать refresh token оболочки.
3. Реальный sandbox включает `allow-modals` дополнительно к перечню в CLAUDE.md. Код приоритетнее описания. Работа вложенного редактора, печати и скачивания требует браузерной проверки.
4. Badge: GET `${app.url}/api/platform/badge`, Bearer JWT, опрос раз в 60 секунд и при видимости вкладки, таймаут 8 секунд. Ошибки тихо превращаются в ноль. В TP_Approval нужны точный CORS origin, разрешение Authorization и OPTIONS, Cache-Control: no-store. URL приложения — корень сервиса без query/hash.
5. В apps.js пока нет TP_Approval. Будущая отдельная задача: id `tp-approval`, роль `tp-approval-user`, `badge:true`, `VITE_APP_TP_APPROVAL_URL`, SVG-плитка. Разрешение `admin` в иконке не должно обходить серверную роль приложения.
6. Центр уведомлений — массив Zustand в памяти; подтверждённого внешнего сервиса доставки и контракта приёма подробных уведомлений нет. Не заявлять интеграцию выполненной; оставить адаптер/outbox.
7. CLAUDE.md описывает сопоставление приложений по email. Предлагаем безопаснее: постоянный ключ `(issuer, sub)`; первоначальная привязка существующего внутреннего пользователя по подтверждённому уникальному email только с контролем администратора. Нельзя автоматически перепривязывать аккаунт при изменении email. Это предложение требует утверждения.
8. Dev-токен платформы `dev-token` не является JWT. Backend TP_Approval никогда не принимает его в production. Dev-режим приложения изолируется явно и запрещается при production-конфигурации.
9. Требуются реальные issuer/JWKS, audience или согласованная политика azp, origin и домены. Их нельзя достоверно вывести из README. Настройка Keycloak и платформы не выполнялась.

## Локальный TP_Approval
Текущий фактический каталог `C:\Users\User\codex\проекты\TP_Approval`. Указанный в мастер-задании `C:\Users\User\codex\projects\TP_Approval` отсутствует. Перемещение не выполнялось.
Начальное состояние: `.git`, ветка main без коммитов, `origin/main [gone]`, origin `https://github.com/ashinoff/TP_Approval.git`. GitHub сообщает size=0; это пустой репозиторий, а не готовая кодовая база. Git выводит предупреждение о недоступности глобального ignore; проектный .gitignore создан отдельно. Рабочая ветка не создавалась: пока нет HEAD, изменена только документация.
