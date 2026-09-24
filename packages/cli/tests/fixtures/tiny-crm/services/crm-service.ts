type Contact = { id: string; firstName: string; lastName: string; email: string };
type Sequence = { id: string; status: string; launches: number };
const globals = globalThis as typeof globalThis & {
  tinyCrm?: { contacts: Contact[]; sequences: Map<string, Sequence> };
};
const state = (globals.tinyCrm ??= {
  contacts: [
    { id: 'contact_1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test' },
  ],
  sequences: new Map([['seq_123', { id: 'seq_123', status: 'draft', launches: 0 }]]),
});
export class ContactService {
  static searchContacts(query: string | null) {
    return state.contacts.filter(
      (c) => !query || `${c.firstName} ${c.lastName}`.toLowerCase().includes(query.toLowerCase()),
    );
  }
  static createContact(input: Omit<Contact, 'id'>) {
    const contact = { ...input, id: `contact_${state.contacts.length + 1}` };
    state.contacts.push(contact);
    return contact;
  }
  static deleteContact(id: string) {
    const index = state.contacts.findIndex((c) => c.id === id);
    if (index >= 0) state.contacts.splice(index, 1);
    return { deleted: index >= 0 };
  }
}
export class DealService {
  static createDeal(input: { title: string; amount: number }) {
    return { id: 'deal_1', ...input };
  }
}
export class SequenceService {
  static getSequence(id: string) {
    return state.sequences.get(id);
  }
  static launchSequence(id: string, input: { confirm: boolean }) {
    if (!input.confirm) throw new Error('Launch confirmation required');
    const sequence = state.sequences.get(id);
    if (!sequence) throw new Error('Sequence not found');
    sequence.status = 'launched';
    sequence.launches++;
    return sequence;
  }
}
