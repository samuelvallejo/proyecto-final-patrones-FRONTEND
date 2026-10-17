import {ApiClient} from './api';
import {object, text, flag} from './contracts';
import {panel, html, icon, escape, area, button, field} from './dom';
import {constrain, validate, guidance} from './forms';
import {t} from './i18n';
import './gemini-chat.css';

interface Turn {role: 'user' | 'assistant'; text: string}

/** Memory-only conversation; authenticated requests never include platform or channel records. */
export class GeminiChatView {
  private turns: Turn[] = [];
  private draft = '';
  private pending = false;
  private loading = false;
  private configured = false;
  private model = '';
  private error = '';
  private host: HTMLElement | null = null;
  private generation = 0;

  constructor(private readonly api: ApiClient) {}

  clear(): void {
    this.generation++; this.turns = []; this.draft = ''; this.pending = false;
    this.configured = false; this.error = ''; this.model = ''; this.host = null;
  }

  async mount(host: HTMLElement): Promise<void> {
    this.host = host; this.loading = true; this.error = ''; this.paint();
    const generation = this.generation;
    try {
      const config = object(await this.api.request('GET', '/assistant/chat/config'));
      if (generation !== this.generation) return;
      this.configured = flag(config, 'configured') && text(config, 'provider') === 'GEMINI';
      this.model = text(config, 'model');
    } catch {if (generation === this.generation) this.error = t('geminiChatLoadFailed');}
    finally {if (generation === this.generation) {this.loading = false; this.paint();}}
  }

  private paint(): void {
    if (!this.host?.isConnected) return;
    const section = panel('surface gemini-chat');
    const heading = panel('gemini-chat-heading');
    heading.append(html(`<span class="gemini-chat-symbol">${icon('spark')}</span><div><h2>${escape(t('geminiChatTitle'))}</h2><p>${escape(this.model || t('geminiChatSubtitle'))}</p></div>`));
    const reset = button(t('geminiChatNew'), 'button subtle small', () => {
      this.turns = []; this.draft = ''; this.error = ''; this.paint();
      this.host?.querySelector('textarea')?.focus();
    });
    reset.disabled = this.pending || this.loading; heading.append(reset); section.append(heading);
    const conversation = panel('gemini-chat-messages'); conversation.setAttribute('role', 'log');
    conversation.setAttribute('aria-label', t('geminiChatConversation')); conversation.setAttribute('aria-live', 'polite');
    if (!this.turns.length) {
      conversation.append(html(`<div class="gemini-chat-welcome">${icon('spark')}<h3>${escape(t('geminiChatWelcome'))}</h3><p>${escape(t('geminiChatWelcomeDetail'))}</p></div>`));
      const suggestions = panel('gemini-chat-suggestions');
      for (const prompt of [t('geminiChatPromptOne'), t('geminiChatPromptTwo'), t('geminiChatPromptThree')]) {
        const suggestion = button(prompt, 'button subtle', () => {
          this.draft = prompt; this.paint(); this.host?.querySelector('textarea')?.focus();
        });
        suggestion.disabled = !this.configured || this.pending || this.loading; suggestions.append(suggestion);
      }
      conversation.append(suggestions);
    }
    for (const turn of this.turns) {
      const bubble = panel(`gemini-chat-turn gemini-chat-${turn.role}`);
      const label = document.createElement('strong'); label.textContent = turn.role === 'user' ? t('geminiChatYou') : 'Gemini';
      const body = document.createElement('p'); body.textContent = turn.text; bubble.append(label, body); conversation.append(bubble);
    }
    if (this.pending || this.loading) {
      const waiting = panel('gemini-chat-waiting'); waiting.setAttribute('role', 'status');
      waiting.append(html('<span class="spinner" aria-hidden="true"></span>'), document.createTextNode(t(this.pending ? 'geminiChatThinking' : 'processing')));
      conversation.append(waiting);
    }
    if (this.error) {const notice = panel('gemini-chat-error'); notice.setAttribute('role', 'alert'); notice.textContent = this.error; conversation.append(notice);}
    if (!this.configured && !this.loading && !this.error) {
      const unavailable = panel('form-guidance'); unavailable.textContent = t('geminiChatUnavailable'); conversation.append(unavailable);
    }
    section.append(conversation);
    const form = document.createElement('form'); form.className = 'gemini-chat-form';
    const message = area(t('geminiChatPlaceholder'), this.draft);
    constrain(message, {required: true, max: 2000}, t('geminiChatInputHelp'));
    message.disabled = this.pending || this.loading || !this.configured;
    const caption = field(t('geminiChatQuestion'), message), actions = panel('gemini-chat-actions');
    const counter = document.createElement('small'); counter.textContent = `${message.value.length}/2000`;
    const send = button(t('geminiChatSend'), 'button primary', () => {form.requestSubmit();});
    const update = () => {this.draft = message.value; counter.textContent = `${message.value.length}/2000`; send.disabled = message.disabled || !message.value.trim();};
    message.addEventListener('input', update);
    message.addEventListener('keydown', event => {if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); form.requestSubmit();}});
    form.addEventListener('submit', event => {event.preventDefault(); if (!send.disabled && validate(form)) void this.send(message.value.trim());});
    update(); actions.append(counter, send); form.append(caption, actions);
    guidance(form, t('geminiChatInputHelp')); guidance(form, t('geminiChatPrivacy')); section.append(form);
    this.host.replaceChildren(section);
    if (this.turns.length || this.pending) conversation.scrollTop = conversation.scrollHeight;
  }

  private async send(message: string): Promise<void> {
    if (this.pending || !this.configured || !message) return;
    const generation = this.generation;
    const history = this.turns.slice(-10).map(turn => ({role: turn.role, text: turn.text}));
    while (history.reduce((sum, turn) => sum + turn.text.length, 0) > 22000) history.shift();
    this.turns.push({role: 'user', text: message}); this.draft = ''; this.error = ''; this.pending = true; this.paint();
    try {
      const result = object(await this.api.request('POST', '/assistant/chat', {message, history}));
      if (generation !== this.generation) return;
      const answer = text(result, 'answer');
      if (!answer.trim() || answer.length > 6000 || text(result, 'provider') !== 'GEMINI') throw new Error(t('geminiChatFailed'));
      this.turns.push({role: 'assistant', text: answer});
      this.turns = this.turns.slice(-60);
    } catch (error) {
      if (generation !== this.generation) return;
      this.turns.pop(); this.draft = message;
      this.error = error instanceof Error ? error.message : t('geminiChatFailed');
    } finally {if (generation === this.generation) {this.pending = false; this.paint();}}
  }
}
