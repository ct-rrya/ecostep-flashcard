import { DeckInfo, TeamMember } from '../types';
import seedContent from './seed-content.json';

export const TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'merry',
    name: 'Merry Apple G. Edaño',
    shortName: 'Merry',
    initials: 'ME',
    role: 'Team Lead',
    avatarColor: '#059669',
    defaultPin: '1111',
  },
  {
    id: 'lord',
    name: 'Lord Jason G. Riveral',
    shortName: 'Lord Jason',
    initials: 'LR',
    role: 'Member',
    avatarColor: '#171717',
    defaultPin: '2222',
  },
  {
    id: 'jerome',
    name: 'Jerome M. Magdadaro',
    shortName: 'Jerome',
    initials: 'JM',
    role: 'Member',
    avatarColor: '#262626',
    defaultPin: '3333',
  },
  {
    id: 'jhemarsh',
    name: 'Jhemarsh Lee Conde',
    shortName: 'Jhemarsh',
    initials: 'JC',
    role: 'Member',
    avatarColor: '#404040',
    defaultPin: '4444',
  },
  {
    id: 'alyza',
    name: 'Alyza G. Pitogo',
    shortName: 'Alyza',
    initials: 'AP',
    role: 'Member',
    avatarColor: '#525252',
    defaultPin: '5555',
  },
  {
    id: 'francis',
    name: 'Francis Keith Banan',
    shortName: 'Francis',
    initials: 'FB',
    role: 'Member',
    avatarColor: '#27272a',
    defaultPin: '6666',
  },
];

export const DECKS: DeckInfo[] = seedContent.decks as DeckInfo[];
