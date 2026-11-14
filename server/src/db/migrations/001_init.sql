-- GoatHub : schéma initial de la base de données

CREATE TABLE users (
  id               BIGSERIAL PRIMARY KEY,
  email_hash       TEXT NOT NULL UNIQUE,          -- empreinte HMAC de l'email (pour le retrouver)
  email_enc        TEXT NOT NULL,                 -- email chiffré (AES-256-GCM)
  username         TEXT NOT NULL,
  password_hash    TEXT NOT NULL,                 -- Argon2id
  avatar_id        TEXT,
  accent_color     TEXT NOT NULL DEFAULT '#7c5cff',
  bio              TEXT NOT NULL DEFAULT '',
  custom_status    TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'idle', 'dnd', 'invisible')),
  totp_secret_enc  TEXT,
  totp_pending_enc TEXT,
  totp_last_step   BIGINT NOT NULL DEFAULT 0,
  recovery_codes   TEXT[] NOT NULL DEFAULT '{}',  -- empreintes des codes de secours
  is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

CREATE TABLE sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  device      TEXT NOT NULL DEFAULT '',
  network     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE known_devices (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (user_id, fingerprint)
);

CREATE TABLE security_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  details    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user ON security_events (user_id, id DESC);

-- Amis : une ligne par sens. (moi, autre, 'pending') = j'ai envoyé une demande
CREATE TABLE friendships (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, other_id)
);
CREATE INDEX friendships_other ON friendships (other_id);

CREATE TABLE uploads (
  id         TEXT PRIMARY KEY,                    -- identifiant aléatoire (128 bits)
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  stored     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'file')),
  size       INTEGER NOT NULL,
  channel_id BIGINT,                              -- salon où le fichier a été envoyé (contrôle d'accès)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE servers (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  icon_id    TEXT,
  owner_id   BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id          BIGSERIAL PRIMARY KEY,
  server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#9aa4b8',
  permissions BIGINT NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,          -- plus grand = plus haut dans la hiérarchie
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,      -- le rôle @everyone
  hoist       BOOLEAN NOT NULL DEFAULT TRUE        -- affiché à part dans la liste des membres
);
CREATE INDEX roles_server ON roles (server_id);

CREATE TABLE members (
  server_id   BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname    TEXT,
  muted_until TIMESTAMPTZ,                         -- exclusion temporaire (ne peut plus écrire ni parler)
  voice_muted BOOLEAN NOT NULL DEFAULT FALSE,      -- rendu muet en vocal par un modérateur
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX members_user ON members (user_id);

CREATE TABLE member_roles (
  server_id BIGINT NOT NULL,
  user_id   BIGINT NOT NULL,
  role_id   BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (server_id, user_id) REFERENCES members(server_id, user_id) ON DELETE CASCADE
);
CREATE INDEX member_roles_server ON member_roles (server_id);

CREATE TABLE bans (
  server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL DEFAULT '',
  banned_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE invites (
  code       TEXT PRIMARY KEY,
  server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  max_uses   INTEGER,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invites_server ON invites (server_id);

CREATE TABLE categories (
  id        BIGSERIAL PRIMARY KEY,
  server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

-- Salon de serveur (text / voice) ou conversation privée (dm / group)
CREATE TABLE channels (
  id         BIGSERIAL PRIMARY KEY,
  server_id  BIGINT REFERENCES servers(id) ON DELETE CASCADE,
  category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  type       TEXT NOT NULL CHECK (type IN ('text', 'voice', 'dm', 'group')),
  name       TEXT NOT NULL DEFAULT '',
  topic      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  slowmode   INTEGER NOT NULL DEFAULT 0,          -- secondes entre deux messages d'une même personne
  user_limit INTEGER NOT NULL DEFAULT 0,          -- vocal : 0 = illimité
  owner_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- groupe privé
  dm_key     TEXT UNIQUE,                         -- conversation à deux : « petitId:grandId »
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX channels_server ON channels (server_id);

CREATE TABLE channel_recipients (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX channel_recipients_user ON channel_recipients (user_id);

CREATE TABLE messages (
  id               BIGSERIAL PRIMARY KEY,
  channel_id       BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  content          TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL DEFAULT 'default',  -- default | call | system
  attachments      JSONB NOT NULL DEFAULT '[]',
  mentions         BIGINT[] NOT NULL DEFAULT '{}',
  mention_everyone BOOLEAN NOT NULL DEFAULT FALSE,
  reply_to         BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  pinned           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at        TIMESTAMPTZ
);
CREATE INDEX messages_channel ON messages (channel_id, id DESC);
CREATE INDEX messages_pinned ON messages (channel_id) WHERE pinned;

CREATE TABLE reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE read_states (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE reports (
  id             BIGSERIAL PRIMARY KEY,
  reporter_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  server_id      BIGINT REFERENCES servers(id) ON DELETE CASCADE,
  message_id     BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  message_copy   TEXT NOT NULL DEFAULT '',          -- copie du message signalé (preuve)
  reason         TEXT NOT NULL,
  details        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  handled_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_server ON reports (server_id, status);

-- Journal de modération de chaque serveur
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  server_id  BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  actor_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_server ON audit_log (server_id, id DESC);
