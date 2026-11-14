import { Menu as MenuIcon } from 'lucide-react';
import { useEffect } from 'react';
import { navigate, useRoute } from '../../lib/router';
import { rawEmit } from '../../lib/socket';
import { set, useStore } from '../../lib/store';
import { local } from '../../lib/storage';
import { cx } from '../../lib/format';
import { ChatView } from '../chat/ChatView';
import { FriendsView } from '../FriendsView';
import { InviteView } from '../InviteView';
import { Modals } from '../modals/Modals';
import { PopoverLayer } from '../ui/Menu';
import { Toasts } from '../ui/Toasts';
import { IncomingCalls } from '../voice/IncomingCalls';
import { VoiceView } from '../voice/VoiceView';
import { HomeSidebar } from './HomeSidebar';
import { MemberList } from './MemberList';
import { ServerRail } from './ServerRail';
import { ServerSidebar } from './ServerSidebar';
import { UserPanel } from './UserPanel';

/** Passe en « Absent » après 5 minutes sans activité. */
function useIdle() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let idle = false;
    let last = 0;
    const activity = () => {
      const now = Date.now();
      if (now - last < 2000) return;
      last = now;
      if (idle) { idle = false; rawEmit('idle', { idle: false }); }
      clearTimeout(timer);
      timer = setTimeout(() => { idle = true; rawEmit('idle', { idle: true }); }, 5 * 60_000);
    };
    activity();
    for (const ev of ['mousemove', 'keydown', 'mousedown', 'touchstart']) window.addEventListener(ev, activity, { passive: true });
    return () => { clearTimeout(timer); for (const ev of ['mousemove', 'keydown', 'mousedown', 'touchstart']) window.removeEventListener(ev, activity); };
  }, []);
}

export function Shell() {
  const route = useRoute();
  const servers = useStore((s) => s.servers);
  const mobileNav = useStore((s) => s.mobileNav);
  const lastChannel = useStore((s) => s.lastChannel);
  const pendingInvite = useStore((s) => s.pendingInvite);
  useIdle();

  // Après une connexion depuis un lien d'invitation, on affiche l'invitation
  useEffect(() => {
    if (pendingInvite) { set({ pendingInvite: null }); navigate(`/invite/${pendingInvite}`, true); }
  }, [pendingInvite]);

  // Choisit un salon par défaut quand on ouvre un serveur
  const server = route.name === 'server' ? servers[route.serverId] : undefined;
  useEffect(() => {
    if (route.name !== 'server') return;
    if (!server) { navigate('/channels/@me', true); return; }
    const channel = server.channels.find((c) => c.id === route.channelId);
    if (!channel) {
      const fallback = server.channels.find((c) => c.id === lastChannel[server.id] && c.type === 'text') ?? server.channels.find((c) => c.type === 'text');
      if (fallback) navigate(`/channels/${server.id}/${fallback.id}`, true);
    } else if (channel.type === 'text') {
      const next = { ...lastChannel, [server.id]: channel.id };
      if (lastChannel[server.id] !== channel.id) { set({ lastChannel: next }); local.set('lastChannel', next); }
    }
  }, [route, server, lastChannel]);

  useEffect(() => { set({ mobileNav: false }); }, [route]);

  const channel = server?.channels.find((c) => c.id === (route.name === 'server' ? route.channelId : -1));

  let main;
  if (route.name === 'invite') main = <InviteView code={route.code} />;
  else if (route.name === 'home') main = route.dmId ? <ChatView key={`dm${route.dmId}`} channelId={route.dmId} /> : <FriendsView />;
  else if (channel?.type === 'voice') main = <VoiceView key={`v${channel.id}`} channelId={channel.id} serverId={server!.id} />;
  else if (channel) main = <ChatView key={`c${channel.id}`} channelId={channel.id} serverId={server!.id} />;
  else main = <div className="grid flex-1 place-items-center text-zinc-500">Ce serveur n'a pas encore de salon.</div>;

  return (
    <div className="flex h-full overflow-hidden bg-ink-950">
      <div className={cx('fixed inset-0 z-40 bg-black/60 md:hidden', mobileNav ? 'block' : 'hidden')} onClick={() => set({ mobileNav: false })} />
      <div className={cx('fixed inset-y-0 left-0 z-40 flex w-[312px] transition-transform duration-200 md:static md:w-auto md:translate-x-0', mobileNav ? 'translate-x-0 shadow-pop' : '-translate-x-[110%]')}>
        <ServerRail />
        <aside className="flex w-60 shrink-0 flex-col bg-ink-850">
          {route.name === 'server' && server ? <ServerSidebar server={server} /> : <HomeSidebar />}
          <UserPanel />
        </aside>
      </div>
      <main className="flex min-w-0 flex-1 flex-col bg-ink-800">
        <button className="btn-icon absolute left-2 top-2.5 z-30 md:hidden" onClick={() => set({ mobileNav: true })} aria-label="Ouvrir le menu"><MenuIcon size={20} /></button>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{main}</div>
          {server && channel?.type === 'text' && <MemberList server={server} />}
        </div>
      </main>
      <IncomingCalls />
      <Modals />
      <PopoverLayer />
      <Toasts />
    </div>
  );
}
