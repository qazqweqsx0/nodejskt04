# КТ-04 — блог-платформа: аутентификация, RBAC и тесты

Расширение проекта **КТ-03**: к CRUD-API блог-платформы добавлены регистрация и вход,
JWT-аутентификация с refresh-токеном в httpOnly cookie, разграничение доступа по ролям,
меры безопасности и автоматические тесты на Jest + Supertest.

Стек: Node.js, Express 4, Prisma ORM 6, SQLite, JWT (`jsonwebtoken`), bcryptjs,
helmet, express-rate-limit, Joi, Jest, Supertest.

## Что добавлено по сравнению с КТ-03

- регистрация с хэшированием пароля (bcrypt) и логин с выдачей access/refresh токенов;
- обновление access-токена по refresh-токену из httpOnly cookie;
- роли `USER`, `MODERATOR`, `ADMIN` и проверка прав на маршрутах;
- ограничение доступа к списку пользователей и смене ролей;
- helmet, rate limiting на `/auth/login`, лимит тела запроса 10 kb;
- приложение разделено на `src/app.js` (сборка Express-приложения) и `src/server.js` (запуск сервера);
- 25 автотестов (Jest + Supertest), запуск командой `npm test`.

## Структура

```
kt04/
├── prisma/
│   ├── schema.prisma              # User (password, role), Post, Tag
│   └── migrations/                # миграции БД
├── src/
│   ├── app.js                     # Express-приложение (без listen)
│   ├── server.js                  # точка входа: listen + graceful shutdown
│   ├── config/
│   │   └── index.js               # .env, JWT, cookie, лимиты
│   ├── middleware/
│   │   ├── auth.js                # authenticate, requireRole
│   │   ├── validate.js            # Joi-валидация body/query/params
│   │   └── errorHandler.js        # ApiError, 404, маппинг ошибок Prisma
│   ├── routes/
│   │   ├── auth.js                # /auth/register|login|refresh|logout|me
│   │   ├── users.js               # /api/users
│   │   ├── posts.js               # /api/posts
│   │   └── admin.js               # /admin/users/:id/role
│   └── utils/
│       ├── jwt.js                 # подпись и проверка access/refresh токенов
│       └── password.js            # hashPassword / verifyPassword
├── tests/
│   ├── auth.test.js               # регистрация, логин, refresh, logout, me
│   ├── rbac.test.js               # права ролей и владение постами
│   ├── security.test.js           # helmet, лимит тела, скрытие stack trace
│   ├── jwt.test.js                # unit-тесты утилиты JWT
│   ├── helpers.js                 # общие хелперы тестов
│   ├── setupEnv.js                # переменные окружения для тестов
│   └── globalSetup.js             # подготовка тестовой БД
├── .env
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Быстрый старт

```bash
cd kt04
npm install

# Windows (PowerShell)
Copy-Item .env.example .env
# Linux / macOS
# cp .env.example .env

npx prisma generate
npx prisma migrate dev
npm start                    # http://localhost:3000
```

Тесты:

```bash
npm test
```

Тесты используют отдельную БД `prisma/test.db`: она автоматически пересоздаётся в
`globalSetup` перед прогоном, боевая `prisma/dev.db` не затрагивается.

## Переменные окружения

| Переменная | По умолчанию | Описание |
| --- | --- | --- |
| `NODE_ENV` | `development` | окружение; в `production` обязательны JWT-секреты |
| `PORT` | `3000` | порт сервера |
| `DATABASE_URL` | `file:./dev.db` | подключение Prisma (SQLite-файл относительно `prisma/`) |
| `JWT_ACCESS_SECRET` | — | секрет access-токенов |
| `JWT_REFRESH_SECRET` | — | секрет refresh-токенов |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | время жизни access-токена |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | время жизни refresh-токена |
| `BCRYPT_ROUNDS` | `10` | сложность хэширования пароля |
| `LOGIN_RATE_LIMIT_MAX` | `10` | число попыток логина за 15 минут |
| `BODY_LIMIT` | `10kb` | максимальный размер JSON-тела |

## Аутентификация

Access-токен передаётся в заголовке `Authorization: Bearer <token>` и живёт 15 минут.
Refresh-токен кладётся в httpOnly cookie `refreshToken` (SameSite=Lax, `Secure` в production,
время жизни 7 дней) и используется только на `/auth/refresh` и `/auth/logout`.

### POST /auth/register

```json
{ "email": "alice@example.com", "name": "Alice", "password": "Password123!" }
```

`201 Created` — пользователь без пароля:

```json
{ "data": { "id": 1, "email": "alice@example.com", "name": "Alice", "role": "USER", "createdAt": "..." } }
```

Пароль хранится только в виде bcrypt-хэша. Повторный email — `409 Conflict`.

### POST /auth/login

```bash
curl -i -c cookies.txt -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Password123!"}'
```

`200 OK`, в теле access-токен и пользователь, в `Set-Cookie` — refresh-токен:

```json
{
  "accessToken": "eyJhbGciOi...",
  "user": { "id": 1, "email": "alice@example.com", "name": "Alice", "role": "USER", "createdAt": "..." }
}
```

Неверная пара email/пароль — `401 Unauthorized`. Не более 10 запросов за 15 минут с одного IP,
дальше — `429 Too Many Requests`.

### POST /auth/refresh

```bash
curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:3000/auth/refresh
```

`200 OK` — новый access-токен, refresh-cookie перевыпускается:

```json
{ "accessToken": "eyJhbGciOi..." }
```

Без cookie или с недействительным токеном — `401 Unauthorized`.

### POST /auth/logout

```bash
curl -i -b cookies.txt -X POST http://localhost:3000/auth/logout
```

`204 No Content`, refresh-cookie очищается.

### GET /auth/me

Только для аутентифицированных:

```bash
curl http://localhost:3000/auth/me -H "Authorization: Bearer <accessToken>"
```

```json
{ "data": { "id": 1, "email": "alice@example.com", "name": "Alice", "role": "USER", "createdAt": "..." } }
```

## RBAC

| Маршрут | USER | MODERATOR | ADMIN |
| --- | --- | --- | --- |
| `GET /api/posts` | ✓ | ✓ | ✓ |
| `POST /api/posts` | ✓ | ✓ | ✓ |
| `PATCH /api/posts/:id` | только свои | любые | любые |
| `DELETE /api/posts/:id` | только свои | любые | любые |
| `GET /api/users` | ✗ | ✓ | ✓ |
| `PATCH /admin/users/:id/role` | ✗ | ✗ | ✓ |

Дополнительно:

- `GET /api/users/:id` — любой аутентифицированный пользователь;
- `PATCH /api/users/:id` — только свой профиль или ADMIN;
- `DELETE /api/users/:id` — только свой профиль или ADMIN;
- `POST /api/posts` — автор берётся из access-токена; передать `authorId` другого
  пользователя может только MODERATOR/ADMIN;
- роль пользователя проверяется по БД на каждом запросе, поэтому смена роли
  действует сразу, без перевыпуска токена.

Все маршруты `/api/posts` и `/api/users` требуют access-токен: без него — `401`,
при недостатке прав — `403`.

## API постов

Поддерживаются параметры КТ-03: `search` (по заголовку, без учёта регистра),
`published`, `authorId`, `page`, `limit`; ответ — `{ data, meta: { total, page, limit, pages } }`.

```bash
curl "http://localhost:3000/api/posts?search=prisma&published=true&page=1&limit=5" \
  -H "Authorization: Bearer <accessToken>"
```

Создание поста (теги — массив строк, создаются через `connectOrCreate`):

```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello Prisma","content":"Текст","published":true,"tags":["node","prisma"]}'
```

`PATCH /api/posts/:id` с полем `tags` заменяет набор тегов (`tags: []` очищает).

## Безопасность

- **helmet** на всех ответах: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`
  и остальные заголовки по умолчанию; `x-powered-by` отключён.
- **Rate limiting** на `/auth/login`: 10 запросов за 15 минут (настраивается `LOGIN_RATE_LIMIT_MAX`),
  при превышении — `429` в общем формате ошибок.
- **Лимит тела запроса** — 10 kb (`express.json({ limit: '10kb' })`), больше — `413`.
- **Пароли** — bcrypt, в ответах и выборках API пароль не возвращается.
- **JWT**: отдельные секреты и типы (`access`/`refresh`); refresh-токен нельзя использовать
  как access и наоборот.
- **Cookie**: httpOnly, SameSite=Lax, `Secure` в production, ограниченный срок жизни.
- **Error handler** не отдаёт stack trace при `NODE_ENV=production`; в development stack
  выводится только для ошибок 5xx.
- **Валидация** всех входных данных через Joi (`stripUnknown`, приведение типов).
- Удаление пользователя каскадно удаляет его посты (`onDelete: Cascade`).

## Тесты

```bash
npm test
```

25 тестов, 4 файла:

- `auth.test.js` — регистрация (успех, дубликат email), логин (успех, неверный пароль),
  `/auth/me` с токеном и без, refresh по cookie, refresh без cookie, logout;
- `rbac.test.js` — USER не видит список пользователей, MODERATOR/ADMIN видят;
  создание постов всеми ролями, владелец удаляет свой пост, другой USER получает 403,
  MODERATOR удаляет чужой пост, смена роли только ADMIN;
- `security.test.js` — заголовки helmet, лимит тела 10 kb (413), скрытие stack trace в production;
- `jwt.test.js` — unit-тесты подписи/проверки access-токена, запрет refresh-токена
  в роли access, отклонение чужой подписи.

Ожидаемый результат:

```
Test Suites: 4 passed, 4 total
Tests:       25 passed, 25 total
```

## Отличия от КТ-03

- `POST /api/users` удалён: регистрация только через `POST /auth/register` с паролем;
- у модели `User` появилось поле `password`, в enum `Role` добавлена роль `MODERATOR`;
- все маршруты постов и пользователей защищены аутентификацией;
- добавлены `/auth/*` и `/admin/users/:id/role`;
- `src/index.js` заменён на `src/app.js` + `src/server.js` для тестируемости.
