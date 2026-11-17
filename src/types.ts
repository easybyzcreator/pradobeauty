export interface Professional {
  id: string;
  name: string;
  avatar?: string;
  zelleQR?: string;
  qrCodes?: { label: string, image: string }[];
  departments: ('hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic')[];
  order: number;
  deptOrder?: Record<string, number>;
  isActive: boolean;
  workingHours?: WorkingHours;
}

export interface BlacklistRecord {
  id: string;
  phone: string;
  email?: string;
  reason?: string;
  createdAt: any;
}

export interface Category {
  id: string;
  title: string;
  order: number;
  department?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic';
}

export type PriceType = 'fixed' | 'starting' | 'consult';

export interface Side {
  id: string;
  name: string;
  price: number;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  oldPrice?: number;
  priceType?: PriceType;
  duration?: number; // In minutes
  gender?: 'feminino' | 'masculino' | 'ambos';
  department?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic';
  image: string; // Base64
  categoryId?: string;
  isMeal?: boolean;
  ingredients?: string; // Comma separated
  allowedSides?: string[]; // IDs of sides
  isActive?: boolean;
  allowedProfessionals?: string[]; // IDs of professionals allowed to perform this service
  preInstruction?: string;
  postInstruction?: string;
  anamneseFormId?: string;
  maintenanceDays?: number;
  variations?: {
    name: string;
    price: number;
    duration: number;
  }[];
}

export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  variation?: {
    name: string;
    price: number;
    duration: number;
  };
  mealOptions?: {
    removals: string[];
    sides: Side[];
  };
  department?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic';
  appointmentDate?: string;
  appointmentTime?: string;
  professionalId?: string;
}

export interface Order {
  id: string;
  customerName: string;
  phone: string;
  professionalId?: string;
  professionalName?: string;
  instagram?: string;
  address: string;
  street?: string;
  number?: string;
  zipCode?: string;
  city?: string;
  pickupDate?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  status?: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no-show';
  tip?: number;
  discount?: number;
  giftCard?: number;
  gapStart?: string; // For manual gap opening
  gapEnd?: string;   // For manual gap opening
  voucher?: number;
  paymentMethod?: string;
  confirmationMethod?: 'whatsapp' | 'sms';
  formulaNotes?: string;
  notes?: string;
  anamneseAnswers?: Record<string, any>;
  birthday: string;
  observation: string;
  email: string;
  department?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic';
  items: {
    productId?: string;
    title: string;
    quantity: number;
    price: number;
    priceType?: PriceType;
    duration?: number;
    mealOptions?: {
      removals: string[];
      sides: Side[];
    };
    appointmentDate?: string;
    appointmentTime?: string;
    department?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic';
    professionalId?: string;
    professionalName?: string;
    status?: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no-show';
  }[];
  total: number;
  createdAt: any;
  orderLanguage?: string;
}

export interface Holiday {
  id?: string;
  date: string;
  departments: ('hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic' | 'all')[];
  professionalId?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
}

export interface Settings {
  logo: string;
  primaryColor: string;
  whatsappNumber: string;
  whatsappCountryCode?: string;
  slug: string;
  brandName: string;
  adminPassword?: string;
  slogan?: string;
  welcomeSlogan?: string;
  hairSlogan?: string;
  makeupSlogan?: string;
  nailsSlogan?: string;
  spaSlogan?: string;
  clinicSlogan?: string;
  aestheticSlogan?: string;
  whatsappClosingMessage?: string;
  whatsappPostAtendimentoMessage?: string;
  backgroundImage?: string;
  glassColor?: string;
  textColor?: string;
  language?: 'pt' | 'en';
  currency?: 'BRL' | 'USD';
  checkoutTitle?: string;
  infoBlock1Title?: string;
  infoBlock1Text?: string;
  infoBlock2Title?: string;
  infoBlock2Text?: string;
  zelleQR?: string;
  venmoQR?: string;
  paypalQR?: string;
  debitCardQR?: string;
  creditCardQR?: string;
  pixQR?: string;
  holidays?: (string | Holiday)[];
  showHair?: boolean;
  showMakeup?: boolean;
  showNails?: boolean;
  showSpa?: boolean;
  showClinic?: boolean;
  showAesthetic?: boolean;
  hairIcon?: string;
  makeupIcon?: string;
  nailsIcon?: string;
  spaIcon?: string;
  clinicIcon?: string;
  aestheticIcon?: string;
  hairLabel?: string;
  makeupLabel?: string;
  nailsLabel?: string;
  spaLabel?: string;
  clinicLabel?: string;
  aestheticLabel?: string;
  hairPassword?: string;
  makeupPassword?: string;
  nailsPassword?: string;
  spaPassword?: string;
  clinicPassword?: string;
  aestheticPassword?: string;
  businessDescription?: string;
  seoAnalysis?: string;
  seoHistory?: {
    id: string;
    date: string;
    businessDescription: string;
    analysis: string;
  }[];
  reminderTemplateToday?: string;
  reminderTemplate48h?: string;
  customMessageCardTitle?: string;
  customMessageCardText?: string;
  customMessageCardUrl?: string;
  customReminderMessage?: string;
  departmentIcons?: {
    hair: string;
    makeup: string;
    nails: string;
    spa?: string;
    clinic?: string;
    aesthetic?: string;
  };
  workingHours?: WorkingHours;
  hairWorkingHours?: WorkingHours;
  makeupWorkingHours?: WorkingHours;
  nailsWorkingHours?: WorkingHours;
  spaWorkingHours?: WorkingHours;
  clinicWorkingHours?: WorkingHours;
  aestheticWorkingHours?: WorkingHours;
  noShowFee?: number;
  noShowMessageTemplate?: string;
  noShowPaymentInstructions?: string;
  bloqueiosCollectionReady?: boolean;
}

export interface DaySchedule {
  isOpen: boolean;
  start: string; // "09:00"
  end: string;   // "18:00"
}

export interface AnamneseQuestion {
  id: string;
  label: string;
  type: 'text' | 'choice';
  options?: string[]; // For multiple choice
  required: boolean;
}

export interface AnamneseForm {
  id: string;
  title: string;
  department?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic';
  productId?: string;
  questions: AnamneseQuestion[];
}

export interface WorkingHours {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

export interface CustomerRecord {
  id: string; // Usually phone or email
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  anamneseHistory?: {
    formTitle: string;
    date: any;
    answers: Record<string, any>;
  }[];
  formulas: {
    date: any;
    text: string;
    photos?: string[];
  }[];
}
