import {panel} from './dom';
import {t} from './i18n';

export interface FieldRules {max?: number; min?: number; required?: boolean; pattern?: string; step?: string; bytes?: number; lines?: number; lineLength?: number}
/** Prevent excess input locally; validate again before crossing the API boundary. */
export function constrain(control: HTMLInputElement | HTMLTextAreaElement, rules: FieldRules, hint: string): void {
  if (rules.max !== undefined) control.maxLength = rules.max;
  control.required = rules.required ?? false;
  if (control instanceof HTMLInputElement) {
    if (rules.pattern) control.pattern = rules.pattern;
    if (control.type === 'number') {
      if (rules.min !== undefined) control.min = String(rules.min);
      if (rules.max !== undefined) control.max = String(rules.max);
      control.step = rules.step ?? '1';
    } else if (rules.min !== undefined) control.minLength = rules.min;
  }
  control.dataset.rules = JSON.stringify(rules);
  control.dataset.validationHint=hint;
  const note = document.createElement('small'); note.className = 'form-hint'; note.textContent = hint;
  note.id = `${control.id}-help`; control.setAttribute('aria-describedby', note.id); control.parentElement?.append(note);
  control.addEventListener('input', () => {
    if (rules.bytes) while (new TextEncoder().encode(control.value).length > rules.bytes) control.value = [...control.value].slice(0, -1).join('');
    if (rules.lines || rules.lineLength) control.value = control.value.split('\n').slice(0, rules.lines).map(line => line.slice(0, rules.lineLength)).join('\n');
    if (control instanceof HTMLInputElement && control.type === 'number' && control.value && Number.isFinite(control.valueAsNumber)) {
      if (rules.max !== undefined && control.valueAsNumber > rules.max) control.value = String(rules.max);
      if (rules.min !== undefined && control.valueAsNumber < rules.min) control.value = String(rules.min);
    }
    control.setCustomValidity('');
  });
}
export function validate(container: ParentNode): boolean {
  for (const control of container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')) {
    if (control.disabled) continue;
    control.setCustomValidity('');
    if (control.required && !control.value.trim()) control.setCustomValidity(t('formRequired'));
    const rules=control.dataset.rules ? JSON.parse(control.dataset.rules) as FieldRules : {};
    if (!(control instanceof HTMLInputElement && control.type==='number') && rules.max && control.value.length>rules.max) control.setCustomValidity(control.dataset.validationHint ?? t('formRequired'));
    if (control instanceof HTMLInputElement && control.type!=='number' && rules.min && control.value.length<rules.min) control.setCustomValidity(control.dataset.validationHint ?? t('formRequired'));
    if (!control.checkValidity()) {control.reportValidity(); control.focus(); return false;}
  }
  return true;
}
export function guidance(container: HTMLElement, text: string): void {
  const note = panel('form-guidance'); note.textContent = text; container.append(note);
}
