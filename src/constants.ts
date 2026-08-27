export const DEFAULT_LOGO = 'https://i.ibb.co/WWSfGd4x/easy-beauty.png';
export const DEFAULT_BACKGROUND = 'https://i.ibb.co/SD9BYwcn/patitour-2026-04-17-T085923-776.png';

export const INITIAL_CATEGORIES = [
  // Exemplo: { id: 'cat1', title: 'Depilação', order: 0 }
];

export const INITIAL_PRODUCTS = [
  /* 
    Exemplo de como preencher:
    {
      title: 'Depilação Completa',
      description: 'Descrição do serviço...',
      price: 50.00,
      gender: 'feminino',
      categoryId: 'cat1',
      image: 'link-da-imagem'
    }
  */
];

export const DEFAULT_WORKING_HOURS = {
  monday: { isOpen: true, start: '09:00', end: '18:00' },
  tuesday: { isOpen: true, start: '09:00', end: '18:00' },
  wednesday: { isOpen: true, start: '09:00', end: '18:00' },
  thursday: { isOpen: true, start: '09:00', end: '18:00' },
  friday: { isOpen: true, start: '09:00', end: '18:00' },
  saturday: { isOpen: false, start: '09:00', end: '14:00' },
  sunday: { isOpen: false, start: '09:00', end: '12:00' },
};
