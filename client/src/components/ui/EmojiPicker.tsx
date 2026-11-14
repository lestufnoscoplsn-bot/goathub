import { useState } from 'react';
import { cx } from '../../lib/format';
import { local } from '../../lib/storage';

const EMOJIS: Record<string, string> = {
  'Récents': '',
  'Visages': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖',
  'Gestes': '👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💪 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 💥 💫 🔥 ✨ ⭐ 🌟 🎉 🎊',
  'Nature': '🐐 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🐺 🐴 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳 🌵 🌲 🌴 🌱 🍀 🌸 🌹 🌻 🌙 ☀️ ⛅ 🌧️ ⚡ ❄️ 🌈 🌊',
  'Nourriture': '🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥝 🍅 🥑 🥕 🌽 🍞 🥐 🧀 🍗 🍔 🍟 🍕 🌭 🌮 🍣 🍜 🍝 🍰 🎂 🍪 🍫 🍬 🍩 🍿 ☕ 🍵 🥤 🍺 🍷 🥂',
  'Activités': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🎱 🎮 🕹️ 🎲 🎯 🎳 🎸 🎹 🥁 🎤 🎧 🎬 🎨 🏆 🥇 🚗 🚀 ✈️ 🚲 🏠 💻 📱 ⌚ 📷 💡 📚 ✏️ 💰 🎁 🔑 🔒 ⏰ 📌',
  'Symboles': '✅ ❌ ❓ ❗ ⚠️ 🚫 💬 👑 🔔 🎵 ➕ ➖ ♻️ 🆗 🆒 🆕 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪',
};

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const recent = local.get<string[]>('recentEmojis', []);
  const [tab, setTab] = useState(recent.length ? 'Récents' : 'Visages');
  const list = tab === 'Récents' ? recent : EMOJIS[tab].split(' ');
  const pick = (e: string) => {
    local.set('recentEmojis', [e, ...recent.filter((r) => r !== e)].slice(0, 24));
    onPick(e);
  };
  return (
    <div className="w-[340px] overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-pop">
      <div className="flex gap-1 border-b border-ink-600 p-1.5">
        {Object.keys(EMOJIS).filter((k) => k !== 'Récents' || recent.length).map((k) => (
          <button key={k} title={k} onClick={() => setTab(k)} className={cx('rounded-md px-2 py-1 text-lg transition', tab === k ? 'bg-ink-600' : 'opacity-60 hover:opacity-100')}>
            {k === 'Récents' ? '🕘' : EMOJIS[k].split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="grid max-h-64 grid-cols-8 overflow-y-auto p-1.5">
        {list.map((e) => <button key={e} onClick={() => pick(e)} className="rounded-md p-1 text-[22px] leading-tight transition hover:scale-110 hover:bg-ink-600">{e}</button>)}
      </div>
    </div>
  );
}
