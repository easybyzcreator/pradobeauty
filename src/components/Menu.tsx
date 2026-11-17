import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from '../firebase';
import { collection, addDoc, serverTimestamp, query, orderBy, doc, updateDoc, getDocs, where } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { Product, Order, Settings, Category, CartItem, Side, Holiday, AnamneseForm, AnamneseQuestion, Professional, BlacklistRecord, WorkingHours, DaySchedule } from '../types';
import { Plus, Minus, ShoppingBag, X, ArrowLeft, ArrowRight, Scissors, Palette, Sparkles, Clock, CheckCircle2, MessageCircle, MessageSquare, Loader2, Calendar, User, Trash2, CalendarX } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { DEFAULT_LOGO } from '../constants';
import { toast } from 'sonner';

const formatTimeToAMPM = (timeStr: string) => {
  if (!timeStr) return '';
  const [hourStr, minStr] = timeStr.split(':');
  if (!hourStr || !minStr) return timeStr;
  let hour = parseInt(hourStr, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12;
  return `${hour.toString().padStart(2, '0')}:${minStr} ${ampm}`;
};

const formatToMMDDYYYY = (dateStr: string) => {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}/${match[3]}/${match[1]}`;
  }
  return dateStr;
};

const getAnamneseFormForItem = (item: CartItem, products: Product[], anamneseForms: AnamneseForm[]) => {
  let form = anamneseForms.find(f => f.productId === item.productId);
  if (form) return form;

  const product = products.find(p => p.id === item.productId);
  if (product?.anamneseFormId) {
    form = anamneseForms.find(f => f.id === product.anamneseFormId);
    if (form) return form;
  }

  return null;
};

const formatTimeForDate = (time: string, d: string) => {
  if (!time) return null;
  let [t, period] = time.split(' ');
  if (period) {
    let [h, m] = t.split(':').map(Number);
    if (period === 'PM' && h < 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    t = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
  return new Date(`${d}T${t}:00`);
};

const translations = {
  pt: {
    cartTitle: 'Seu Agendamento',
    emptyCart: 'Sua lista está vazia',
    total: 'Total',
    next: 'Próximo: Seus Dados',
    back: 'Voltar',
    finish: 'Finalizar Agendamento',
    fullName: 'Nome Completo',
    phone: 'WhatsApp',
    instagram: 'Instagram',
    email: 'E-mail',
    birthday: 'Aniversário (Dia/Mês)',
    birthdayPlaceholder: 'DD/MM',
    street: 'Rua/Avenida',
    number: 'Nº/Apto',
    zipCode: 'CEP',
    city: 'Cidade',
    observation: 'Observação',
    orderDetails: 'Detalhes do Agendamento',
    consultPrice: 'A consultar',
    startingAt: 'A partir de',
    consultMessage: 'Obs: Este pedido contém itens com valor "A consultar". O valor final será confirmado após a avaliação.',
    customCakeTitle: 'Personalizar Serviço',
    chooseSides: 'Escolha os Extras',
    excludeIngredients: 'Remover Itens',
    limitReached: 'Limite atingido',
    addToCart: 'Adicionar',
    whatsappOrder: 'Agendamento',
    whatsappData: 'Dados da Cliente',
    whatsappItems: 'Serviços Escolhidos',
    whatsappTotal: 'Total',
    whatsappDate: 'Data',
    whatsappAt: 'às',
    pickupDate: 'Data da Sessão',
    pickupDatePlaceholder: 'DD/MM/AAAA',
    appointmentTime: 'Horário',
    totalDuration: 'Duração Total',
    upsellTitle: 'Deseja adicionar outro serviço?',
    upsellText: 'Aproveite para agendar também outros procedimentos e completar sua experiência da beleza!',
    upsellSkip: 'Seguir apenas com os escolhidos',
    viewDetails: 'Ver detalhes'
  },
  en: {
    cartTitle: 'Your Appointment',
    emptyCart: 'Your list is empty',
    total: 'Total',
    next: 'Next: Your Details',
    back: 'Back',
    finish: 'Finish Appointment',
    fullName: 'Full Name',
    phone: 'PHONE NUMBER',
    instagram: 'Instagram',
    email: 'E-mail',
    birthday: 'Birthday (Month/Day)',
    birthdayPlaceholder: 'MM/DD',
    street: 'Street/Avenue',
    number: 'No./Apt',
    zipCode: 'Zip Code',
    city: 'City',
    observation: 'Observation',
    orderDetails: 'Appointment Details',
    consultPrice: 'On request',
    startingAt: 'Starting at',
    consultMessage: 'Note: This order contains items with "Price on request". The final value will be confirmed after evaluation.',
    customCakeTitle: 'Customize Service',
    chooseSides: 'Choose Extras',
    excludeIngredients: 'Remove Items',
    limitReached: 'Limit reached',
    addToCart: 'Add',
    whatsappOrder: 'Appointment',
    whatsappData: 'Customer Data',
    whatsappItems: 'Selected Services',
    whatsappTotal: 'Total',
    whatsappDate: 'Date',
    whatsappAt: 'at',
    pickupDate: 'Session Date',
    pickupDatePlaceholder: 'MM/DD/YYYY',
    appointmentTime: 'Time',
    totalDuration: 'Total Duration',
    upsellTitle: 'Want to add another service?',
    upsellText: 'Take the opportunity to also schedule other procedures and complete your beauty experience!',
    upsellSkip: 'Continue with selected only',
    viewDetails: 'View details'
  },
  es: {
    cartTitle: 'Tu Cita',
    emptyCart: 'Tu lista está vacía',
    total: 'Total',
    next: 'Siguiente: Tus Datos',
    back: 'Volver',
    finish: 'Finalizar Cita',
    fullName: 'Nombre Completo',
    phone: 'WhatsApp',
    instagram: 'Instagram',
    email: 'Correo electrónico',
    birthday: 'Cumpleaños (Día/Mes)',
    birthdayPlaceholder: 'DD/MM',
    street: 'Calle/Avenida',
    number: 'Nº/Apto',
    zipCode: 'Código Postal',
    city: 'Ciudad',
    observation: 'Observación',
    orderDetails: 'Detalles de la Cita',
    consultPrice: 'A consultar',
    startingAt: 'A partir de',
    customCakeTitle: 'Personalizar Servicio',
    chooseSides: 'Elegir Extras',
    excludeIngredients: 'Eliminar Artículos',
    limitReached: 'Límite alcanzado',
    addToCart: 'Añadir',
    whatsappOrder: 'Cita',
    whatsappData: 'Datos de la Cliente',
    whatsappItems: 'Servicios Seleccionados',
    whatsappTotal: 'Total',
    whatsappDate: 'Fecha',
    whatsappAt: 'a las',
    pickupDate: 'Fecha de la Sesión',
    pickupDatePlaceholder: 'DD/MM/AAAA',
    appointmentTime: 'Hora',
    totalDuration: 'Duración Total',
    consultMessage: 'Hay artículos con valores a consultar. Espere confirmación.',
    upsellTitle: '¿Deseas añadir otro servicio?',
    upsellText: '¡Aprovecha para agendar também outros procedimientos y completar tu experiencia de belleza!',
    upsellSkip: 'Seguir solo con los elegidos',
    viewDetails: 'Ver detalles'
  }
};

export default function Menu({ settings }: { settings: Settings }) {
  const [currentLang, setCurrentLang] = useState<'pt' | 'en' | 'es'>(settings.language || 'pt');
  const t = translations[currentLang];
  const currencySymbol = settings.currency === 'USD' ? '$' : 'R$';
  const currencyLocale = settings.currency === 'USD' ? 'en-US' : 'pt-BR';
  
  const getContrastColor = (bgColor: string, preferredColor?: string) => {
    if (!bgColor || bgColor === 'transparent') return preferredColor || '#000000';
    
    const getBrightness = (hex: string) => {
      const h = hex.replace('#', '').replace(' ', '');
      if (h.length === 3) {
        const fullHex = h.split('').map(c => c + c).join('');
        const r = parseInt(fullHex.substring(0, 2), 16);
        const g = parseInt(fullHex.substring(2, 4), 16);
        const b = parseInt(fullHex.substring(4, 6), 16);
        return ((r * 299) + (g * 587) + (b * 114)) / 1000;
      }
      if (h.length !== 6) return 0;
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return ((r * 299) + (g * 587) + (b * 114)) / 1000;
    };

    const bgBrightness = getBrightness(bgColor);
    if (!preferredColor) {
      return bgBrightness > 128 ? '#000000' : '#ffffff';
    }
    const textBrightness = getBrightness(preferredColor);
    if (bgBrightness <= 128 && textBrightness <= 128) return '#ffffff';
    return preferredColor;
  };

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sides, setSides] = useState<Side[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [selectedProductForDetails, setSelectedProductForDetails] = useState<Product | null>(null);
  const [selectedProductForCustom, setSelectedProductForCustom] = useState<Product | null>(null);
  const [mealSelections, setMealSelections] = useState<{
    removals: string[];
    sides: Side[];
  }>({
    removals: [],
    sides: []
  });
  const [anamneseForms, setAnamneseForms] = useState<AnamneseForm[]>([]);
  const [activeAnamneseForm, setActiveAnamneseForm] = useState<AnamneseForm | null>(null);
  const [anamneseAnswers, setAnamneseAnswers] = useState<Record<string, any>>({});
  const [checkoutStep, setCheckoutStep] = useState<'summary' | 'schedule' | 'upsell' | 'anamnese' | 'form'>('summary');
  const [currentSchedulingIndex, setCurrentSchedulingIndex] = useState<number>(0);
  const [confirmationMethod, setConfirmationMethod] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const blacklistLoadedRef = useRef(false);
  const extrasLoadedRef = useRef(false);
  const ordersLoadedRef = useRef(false);
  const [selectedProfessionalForDept, setSelectedProfessionalForDept] = useState<Record<string, string>>({});
  const [selectedDepartment, setSelectedDepartment] = useState<'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic' | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [orderFinalized, setOrderFinalized] = useState<{message: string, whatsappUrl: string, smsUrl: string} | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelForm, setCancelForm] = useState({
    name: '',
    phone: '',
    date: '',
    time: '',
    professionalId: '',
    professionalName: '',
    requestType: 'cancel',
    notes: ''
  });
  const [isSavingCancelRequest, setIsSavingCancelRequest] = useState(false);
  const [cancelRequestFinalized, setCancelRequestFinalized] = useState<{ whatsappUrl: string, smsUrl: string } | null>(null);
  const [formData, setFormData] = useState(() => {
    const saved = localStorage.getItem('easyBeauty_customerData');
    const initial = {
      nome: '',
      telefone: '',
      instagram: '',
      endereco: '',
      street: '',
      number: '',
      zipCode: '',
      city: '',
      aniversario: '',
      observacao: '',
      email: '',
      appointmentDate: '',
      appointmentTime: ''
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...initial, ...parsed, appointmentDate: '', appointmentTime: '' };
      } catch (e) {
        return initial;
      }
    }
    return initial;
  });

  useEffect(() => {
    const { nome, telefone, instagram, email, aniversario } = formData;
    localStorage.setItem('easyBeauty_customerData', JSON.stringify({ nome, telefone, instagram, email, aniversario }));
  }, [formData.nome, formData.telefone, formData.instagram, formData.email, formData.aniversario]);

  const [existingCustomers, setExistingCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);

  const [horariosExtras, setHorariosExtras] = useState<any[]>([]);

  const [isWaitlistModalOpen, setIsWaitlistModalOpen] = useState(false);
  const [isSavingWaitlist, setIsSavingWaitlist] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({
    name: '',
    phone: '',
    department: '',
    service: '',
    preferredDate: '',
    preferredPeriod: 'Anytime',
    notes: ''
  });

  useEffect(() => {
    let isCancelled = false;
    setLoading(true);

    const loadStaticCatalog = async () => {
      try {
        const [
          productsSnap,
          categoriesSnap,
          sidesSnap,
          anamneseSnap,
          profsSnap
        ] = await Promise.all([
          getDocs(query(collection(db, 'produtos'), orderBy('title'))),
          getDocs(query(collection(db, 'categorias'), orderBy('order', 'asc'))),
          getDocs(collection(db, 'acompanhamentos')),
          getDocs(collection(db, 'anamnese_forms')),
          getDocs(query(collection(db, 'profissionais'), orderBy('order', 'asc'))),
        ]);

        if (isCancelled) return;
        setProducts(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
        setCategories(categoriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Category)));
        setSides(sidesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Side)));
        setAnamneseForms(anamneseSnap.docs.map(d => ({ id: d.id, ...d.data() } as AnamneseForm)));
        setProfessionals(profsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Professional)));
      } catch (error) {
        console.error('Menu: Erro ao carregar dados iniciais:', error);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };

    loadStaticCatalog();

    return () => {
      isCancelled = true;
    };
  }, []);

  // Load future appointments & extra slots only when user starts booking (cart has items)
  useEffect(() => {
    if (cart.length === 0) return;

    let isCancelled = false;

    if (!extrasLoadedRef.current) {
      extrasLoadedRef.current = true;
      getDocs(collection(db, 'horarios_extras'))
        .then((snapshot) => {
          if (isCancelled) return;
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const fetched = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter((h: any) => {
              if (!h.date) return false;
              const parts = String(h.date).split('/');
              if (parts.length !== 3) return true;
              const parsed = new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}T12:00:00`);
              return isNaN(parsed.getTime()) || parsed >= todayStart;
            });
          setHorariosExtras(fetched);
        })
        .catch((error) => {
          extrasLoadedRef.current = false;
          console.error('Menu: Erro ao carregar horários extras:', error);
        });
    }

    if (!ordersLoadedRef.current) {
      ordersLoadedRef.current = true;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayISO = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      getDocs(query(collection(db, 'pedidos'), where('appointmentDate', '>=', yesterdayISO)))
        .then((snapshot) => {
          if (isCancelled) return;
          setAllOrders(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Order)));
        })
        .catch((error) => {
          ordersLoadedRef.current = false;
          console.error('Menu: Erro ao carregar pedidos:', error);
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [cart.length > 0]);

  useEffect(() => {
    if (formData.appointmentDate && professionals.length > 0) {
      const dept = selectedDepartment || '';
      if (!selectedProfessionalForDept[dept]) {
        const filteredProfs = professionals
          .filter(p => (p.isActive !== false) && (!selectedDepartment || p.departments.includes(selectedDepartment)))
          .sort((a, b) => {
            const d = selectedDepartment || '';
            const orderA = a.deptOrder?.[d] ?? a.order ?? 0;
            const orderB = b.deptOrder?.[d] ?? b.order ?? 0;
            return orderA - orderB;
          });
        
        if (filteredProfs.length > 0) {
          setSelectedProfessionalForDept(prev => ({
            ...prev,
            [dept]: filteredProfs[0].id
          }));
        }
      }
    }
  }, [formData.appointmentDate, selectedDepartment, professionals, selectedProfessionalForDept]);

  const addToCart = (product: Product) => {
    if (product.variations && product.variations.length > 0) {
      setSelectedProductForCustom(product);
      setVariationSelection(null);
      setIsCustomModalOpen(true);
      return;
    }
    if (product.isMeal) {
      setSelectedProductForCustom(product);
      setMealSelections({
        removals: [],
        sides: []
      });
      setIsCustomModalOpen(true);
      return;
    }

    const existing = cart.find(item => item.productId === product.id && !item.mealOptions && !item.variation);
    let updatedCart: CartItem[];
    if (existing) {
      updatedCart = cart.map(item => item === existing ? { ...item, quantity: item.quantity + 1 } : item);
    } else {
      updatedCart = [...cart, { id: Math.random().toString(36).substr(2, 9), productId: product.id, quantity: 1, department: product.department }];
    }
    setCart(updatedCart);

    if (formData.appointmentDate) {
      const idx = updatedCart.findIndex(item => !item.appointmentDate || !item.appointmentTime);
      setCurrentSchedulingIndex(idx >= 0 ? idx : 0);
      setCheckoutStep('schedule');
      setIsModalOpen(true);
    }
  };

  const [variationSelection, setVariationSelection] = useState<{name: string, price: number, duration: number} | null>(null);

  const addMealToCart = () => {
    if (!selectedProductForCustom) return;
    
    const newItem: CartItem = { 
      id: Math.random().toString(36).substr(2, 9), 
      productId: selectedProductForCustom.id, 
      quantity: 1,
      variation: variationSelection || undefined,
      mealOptions: selectedProductForCustom.isMeal ? { ...mealSelections } : undefined,
      department: selectedProductForCustom.department
    };
    const updatedCart = [...cart, newItem];
    setCart(updatedCart);

    setIsCustomModalOpen(false);
    setSelectedProductForCustom(null);
    setVariationSelection(null);

    if (formData.appointmentDate) {
      const idx = updatedCart.findIndex(item => !item.appointmentDate || !item.appointmentTime);
      setCurrentSchedulingIndex(idx >= 0 ? idx : 0);
      setCheckoutStep('schedule');
      setIsModalOpen(true);
    }
  };

  const removeFromCart = (cartItemId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === cartItemId);
      if (existing && existing.quantity > 1) {
        return prev.map(item => item.id === cartItemId ? { ...item, quantity: item.quantity - 1 } : item);
      }
      return prev.filter(item => item.id !== cartItemId);
    });
  };

  const cartItemsCount = cart.reduce((total, item) => total + item.quantity, 0);
    const cartTotal = cart.reduce((total, item) => {
      const product = products.find(p => p.id === item.productId);
      const basePrice = (product?.price && product.price > 0) ? product.price : (product?.oldPrice || 0);
      let itemPrice = basePrice + (item.variation?.price || 0);
      if (item.mealOptions?.sides) {
        itemPrice += item.mealOptions.sides.reduce((sum, s) => sum + s.price, 0);
      }
      return total + itemPrice * item.quantity;
    }, 0);
  
    const cartTotalDuration = cart.reduce((total, item) => {
      const product = products.find(p => p.id === item.productId);
      const baseDuration = product?.duration || 0;
      const variationDuration = item.variation?.duration || 0;
      return total + (baseDuration + variationDuration) * item.quantity;
    }, 0);

  const handleFinalizar = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Validation: prevent submitting an order where any item is today or in the past!
    const now = new Date();
    const todayStr = (() => {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    })();

    const hasTodayOrPastItem = cart.some(item => {
      const itemDate = item.appointmentDate || formData.appointmentDate;
      if (!itemDate) return false;
      
      // If the selected date is today, block it!
      if (itemDate === todayStr) return true;

      const itemTime = item.appointmentTime || formData.appointmentTime;
      if (!itemTime) return false;
      const start = formatTimeForDate(itemTime, itemDate);
      if (!start || isNaN(start.getTime())) return false;
      return start < now;
    });

    if (hasTodayOrPastItem) {
      setIsSubmitting(false);
      toast.error(currentLang === 'pt'
        ? 'Desculpe, agendamentos para o dia de hoje ou datas passadas não são permitidos. Por favor, selecione outra data.'
        : 'Sorry, appointments for today or past dates are not allowed. Please select another date.'
      );
      return;
    }
    
    const hasConsultItems = cart.some(item => products.find(p => p.id === item.productId)?.priceType === 'consult');
    
    let currentBlacklist = blacklist;
    if (!blacklistLoadedRef.current) {
      try {
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
        const blSnap = await getDocs(collection(db, 'blacklist'));
        currentBlacklist = blSnap.docs.map(d => ({ id: d.id, ...d.data() } as BlacklistRecord));
        setBlacklist(currentBlacklist);
        blacklistLoadedRef.current = true;
      } catch (err) {
        console.error('Menu: Erro ao verificar blacklist:', err);
      }
    }

    const isBlacklisted = currentBlacklist.some(b => 
      b.phone.replace(/\D/g, '') === formData.telefone.replace(/\D/g, '') ||
      (b.email && b.email === formData.email)
    );

    if (isBlacklisted) {
      setIsSubmitting(false);
      toast.error(currentLang === 'pt' 
        ? 'Desculpe, não foi possível completar seu agendamento. Favor entrar em contato via WhatsApp.' 
        : 'Sorry, we could not complete your appointment. Please contact us via WhatsApp.'
      );
      
      const matchingRecord = currentBlacklist.find(b => 
        b.phone.replace(/\D/g, '') === formData.telefone.replace(/\D/g, '') ||
        (b.email && b.email === formData.email)
      );
      if (matchingRecord) {
        const attemptDateStr = formData.appointmentDate || 'N/A';
        const attemptTimeStr = cart[0]?.appointmentTime || formData.appointmentTime || 'N/A';
        const servicesStr = cart.map(item => {
          const product = products.find(p => p.id === item.productId);
          return product ? `${product.title}` : 'Unknown Service';
        }).join(', ');
        try {
          updateDoc(doc(db, 'blacklist', matchingRecord.id), {
            attemptedServices: servicesStr,
            attemptedDate: `${attemptDateStr} ${attemptTimeStr}`,
            attemptedAt: new Date().toISOString()
          });
        } catch (err) {
          console.error("Error updating blacklist record with attempt:", err);
        }
      }
      return;
    }

    const orderItems = cart.map(item => {
      const product = products.find(p => p.id === item.productId)!;
      const basePrice = (product.price && product.price > 0) ? product.price : (product.oldPrice || 0);
      let itemPrice = basePrice + (item.variation?.price || 0);
      if (item.mealOptions?.sides) {
        itemPrice += item.mealOptions.sides.reduce((sum, s) => sum + s.price, 0);
      }
      
      const allowedProfs = professionals.filter(p => {
        if (p.isActive === false) return false;
        const matchesDept = !product.department || p.departments.includes(product.department);
        if (!matchesDept) return false;
        if (!product.allowedProfessionals || product.allowedProfessionals.length === 0) return true;
        return product.allowedProfessionals.includes(p.id);
      }).sort((a, b) => {
        const d = product.department || '';
        const orderA = a.deptOrder?.[d] ?? a.order ?? 0;
        const orderB = b.deptOrder?.[d] ?? b.order ?? 0;
        return orderA - orderB;
      });
      const defaultProfId = allowedProfs[0]?.id || '';

      const directProf = item.professionalId ? professionals.find(p => p.id === item.professionalId) : null;
      const isSavedProfValid = item.professionalId && allowedProfs.some(p => p.id === item.professionalId);
      const testSelectedProfForDept = selectedProfessionalForDept[product.department];
      const isValidSelectedProfForDept = testSelectedProfForDept && allowedProfs.some(p => p.id === testSelectedProfForDept);
      const profId = directProf 
        ? directProf.id 
        : (isSavedProfValid 
            ? item.professionalId 
            : (defaultProfId || (isValidSelectedProfForDept ? testSelectedProfForDept : '')));
      const prof = directProf || professionals.find(p => p.id === profId);
      
      return {
        title: item.variation ? `${product.title} (${item.variation.name})` : product.title,
        quantity: item.quantity,
        price: itemPrice,
        priceType: product.priceType || 'fixed',
        duration: (product.duration || 0) + (item.variation?.duration || 0),
        variation: item.variation || null,
        mealOptions: item.mealOptions || null,
        department: product.department,
        appointmentDate: item.appointmentDate || formData.appointmentDate,
        appointmentTime: item.appointmentTime || formData.appointmentTime,
        professionalId: profId || null,
        professionalName: prof?.name || null
      };
    });

    const targetPhone = formData.telefone.replace(/\D/g, '');
    const targetEmail = formData.email ? formData.email.trim().toLowerCase() : '';

    const hasClientConflict = allOrders.some(order => {
      if (order.status === 'cancelled' || order.status === 'no-show') return false;
      const orderPhone = order.phone ? order.phone.replace(/\D/g, '') : '';
      const orderEmail = order.email ? order.email.trim().toLowerCase() : '';
      const isSameClient = (targetPhone && orderPhone === targetPhone) || (targetEmail && orderEmail === targetEmail);
      if (!isSameClient) return false;

      return orderItems.some(item => {
        const start = formatTimeForDate(item.appointmentTime, item.appointmentDate);
        if (!start || isNaN(start.getTime())) return false;
        const end = new Date(start.getTime() + (item.duration || 0) * 60000);

        return order.items.some(existingItem => {
          const someItemDate = existingItem.appointmentDate || order.appointmentDate;
          const someItemTime = existingItem.appointmentTime || order.appointmentTime;
          if (someItemDate !== item.appointmentDate) return false;

          const existingStart = formatTimeForDate(someItemTime, someItemDate);
          if (!existingStart || isNaN(existingStart.getTime())) return false;
          const existingEnd = new Date(existingStart.getTime() + (existingItem.duration || 0) * 60000);

          return start < existingEnd && end > existingStart;
        });
      });
    });

    if (hasClientConflict) {
      setIsSubmitting(false);
      toast.error(currentLang === 'pt' 
        ? 'Você já possui outro serviço agendado para este mesmo dia e horário!' 
        : 'You already have another service scheduled for this same day and time!'
      );
      return;
    }

    const orderData: Omit<Order, 'id'> = {
      customerName: formData.nome,
      phone: formData.telefone,
      address: `${formData.street}, ${formData.number || 'S/N'} - ${formData.city} (${formData.zipCode})`,
      street: formData.street,
      number: formData.number || '',
      zipCode: formData.zipCode,
      city: formData.city,
      birthday: formData.aniversario || '',
      observation: formData.observacao || '',
      email: formData.email || '',
      appointmentDate: orderItems[0]?.appointmentDate || formData.appointmentDate,
      appointmentTime: orderItems[0]?.appointmentTime || formData.appointmentTime,
      instagram: formData.instagram,
      status: 'pending',
      items: orderItems,
      total: cartTotal,
      confirmationMethod: confirmationMethod,
      anamneseAnswers: Object.keys(anamneseAnswers).length > 0 ? anamneseAnswers : {},
      createdAt: serverTimestamp(),
      orderLanguage: currentLang
    };

    const loadingToast = toast.loading(currentLang === 'pt' ? 'Processando seu agendamento...' : 'Processing your appointment...');

    try {
      await addDoc(collection(db, 'pedidos'), orderData);
      ordersLoadedRef.current = false;
      
      toast.success(currentLang === 'pt' ? 'Dados salvos com sucesso!' : 'Appointment saved successfully!', { id: loadingToast });
      const now = new Date();
      const timeLocale = currentLang === 'en' ? 'en-US' : 'pt-BR';
      const timeStr = now.toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' });
      const dateStr = now.toLocaleDateString(timeLocale);

      let message = `*${t.whatsappOrder} - ${settings.brandName || settings.slug}*\n`;
      message += `*${t.whatsappDate}:* ${dateStr} ${t.whatsappAt} ${timeStr}\n\n`;
      
      message += `*--- ${t.whatsappData} ---*\n`;
      message += `*${t.fullName}:* ${formData.nome}\n`;
      message += `*${t.phone}:* ${formData.telefone}\n`;
      if (formData.instagram) message += `*Instagram:* ${formData.instagram.startsWith('@') ? formData.instagram : '@' + formData.instagram}\n`;
      message += `*${t.email}:* ${formData.email}\n`;
      message += `*${t.birthday}:* ${formData.aniversario}\n`;
      
      const uniqueSchedule = Array.from(new Set(orderItems.map(i => `${i.appointmentDate} ${i.appointmentTime}`)));
      if (uniqueSchedule.length === 1) {
        message += `*${t.pickupDate}:* ${formatToMMDDYYYY(formData.appointmentDate)}\n`;
        message += `*${t.appointmentTime}:* ${formData.appointmentTime}\n`;
      } else {
        message += `*${t.pickupDate}:* ${currentLang === 'en' ? 'Multiple (see items below)' : 'Vários (ver itens abaixo)'}\n`;
      }
      
      message += `*${t.observation}:* ${formData.observacao || '-'}\n\n`;

      message += `*--- ${t.whatsappItems} ---*\n`;
      orderItems.forEach(item => {
        const durationStr = item.duration ? ` (${formatDuration(item.duration)})` : '';
        const dateFriendly = (() => {
          if (!item.appointmentDate) return '';
          const parts = item.appointmentDate.split('-');
          if (parts.length !== 3) return item.appointmentDate;
          const monthIndex = parseInt(parts[1], 10) - 1;
          const day = parseInt(parts[2], 10);
          const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthsPt = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
          const mStr = currentLang === 'en' ? monthsEn[monthIndex] : monthsPt[monthIndex];
          return `${day} ${mStr}`;
        })();
        const itemDateStr = item.appointmentDate ? ` [${dateFriendly} @ ${item.appointmentTime}]` : '';
        const profInfo = item.professionalName ? ` (${currentLang === 'en' ? 'with' : 'com'} ${item.professionalName})` : '';

        if (item.priceType === 'consult') {
          message += `• ${item.quantity}x ${item.title}${durationStr}${itemDateStr}${profInfo} - ${currentLang === 'en' ? '(Price on Request)' : '(Valor a Consultar)'}\n`;
        } else {
          const prefix = item.priceType === 'starting' ? (currentLang === 'en' ? 'Starting at ' : 'A partir de ') : '';
          message += `• ${item.quantity}x ${item.title}${durationStr}${itemDateStr}${profInfo} - ${prefix}${currencySymbol} ${(item.price * item.quantity).toFixed(2)}\n`;
        }
        if (item.mealOptions) {
          if (item.mealOptions.removals.length > 0) {
            message += `  (${currentLang === 'en' ? 'Remove' : 'Remover'}: ${item.mealOptions.removals.join(', ')})\n`;
          }
          if (item.mealOptions.sides.length > 0) {
            message += `  (${currentLang === 'en' ? 'Extras' : 'Acompanhamentos'}: ${item.mealOptions.sides.map(s => s.name).join(', ')})\n`;
          }
        }
      });

      message += `\n*${t.whatsappTotal}:* ${currencySymbol} ${cartTotal.toFixed(2)}${hasConsultItems ? (currentLang === 'en' ? ' + (Price on Request)' : ' + (Valores a Consultar)') : ''}\n`;
      
      const formatTimeForOrderDate = (time: string, date: string) => {
        if (!time) return null;
        let [t, period] = time.split(' ');
        if (period) {
          let [h, m] = t.split(':').map(Number);
          if (period === 'PM' && h < 12) h += 12;
          if (period === 'AM' && h === 12) h = 0;
          t = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        }
        return new Date(`${date}T${t}:00`);
      };

      const sessionTimes = orderItems.map(item => {
        const start = formatTimeForOrderDate(item.appointmentTime, item.appointmentDate);
        if (!start || isNaN(start.getTime())) return null;
        const end = new Date(start.getTime() + (item.duration || 0) * 60000);
        return { start, end };
      }).filter(Boolean) as {start: Date, end: Date}[];
      
      if (sessionTimes.length > 0 && uniqueSchedule.length === 1) {
        const earliestStart = new Date(Math.min(...sessionTimes.map(s => s.start.getTime())));
        const latestEnd = new Date(Math.max(...sessionTimes.map(s => s.end.getTime())));
        const startStr = earliestStart.toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' });
        const endStr = latestEnd.toLocaleTimeString(timeLocale, { hour: '2-digit', minute: '2-digit' });
        message += `*${currentLang === 'en' ? 'Session Time' : currentLang === 'es' ? 'Hora de la Sesión' : 'Horário da Sessão'}:* ${startStr} ${t.whatsappAt} ${endStr}\n`;
      }

      if (cart.length === 1 && cartTotalDuration > 0) {
        message += `*${t.totalDuration}:* ${formatDuration(cartTotalDuration)}\n`;
      }
      
      if (hasConsultItems) {
        message += `\n⚠️ *${t.consultMessage}*\n`;
      }
      
      message += `\n${settings.whatsappClosingMessage || (currentLang === 'en' ? 'Thank you for your order, we will contact you shortly for confirmation!' : 'Obrigada pelo pedido, aguarde que entraremos em contato para confirmação!')}`;

      const encodedMessage = encodeURIComponent(message);
      const countryCodeRaw = settings.whatsappCountryCode?.replace(/\D/g, '') || '1';
      let whatsappNumber = settings.whatsappNumber?.replace(/\D/g, '') || '';
      
      if (whatsappNumber.startsWith(countryCodeRaw)) {
        whatsappNumber = whatsappNumber.slice(countryCodeRaw.length);
      }
      
      const whatsappUrl = `https://wa.me/${countryCodeRaw}${whatsappNumber}?text=${encodedMessage}`;
      const smsUrl = `sms:${countryCodeRaw}${whatsappNumber}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodedMessage}`;
      
      setOrderFinalized({ message, whatsappUrl, smsUrl });
      setCart([]);
      setAnamneseAnswers({});
      setCheckoutStep('summary');
      setFormData({ 
        nome: '', 
        telefone: '', 
        endereco: '', 
        street: '',
        number: '',
        zipCode: '',
        city: '',
        aniversario: '', 
        observacao: '', 
        email: '',
        instagram: '',
        appointmentDate: '',
        appointmentTime: ''
      });

      toast.success(currentLang === 'pt' ? 'Dados salvos com sucesso!' : 'Appointment saved successfully!', { id: loadingToast });
    } catch (error) {
      console.error("Error saving order:", error);
      toast.error(currentLang === 'pt' ? 'Erro ao salvar agendamento. Verifique sua conexão.' : 'Error saving appointment. Check your connection.', { id: loadingToast });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelForm.name || !cancelForm.phone || !cancelForm.date || !cancelForm.time) {
      toast.error('Please fill in all required fields.');
      return;
    }
    setIsSavingCancelRequest(true);
    try {
      const pName = cancelForm.professionalId 
        ? (professionals.find(p => p.id === cancelForm.professionalId)?.name || '') 
        : '';
        
      const requestData = {
        name: cancelForm.name,
        phone: cancelForm.phone,
        date: cancelForm.date,
        time: cancelForm.time,
        professionalId: cancelForm.professionalId || '',
        professionalName: pName || cancelForm.professionalName || 'Any/None',
        requestType: cancelForm.requestType,
        notes: cancelForm.notes || '',
        status: 'pending',
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'cancellation_requests'), requestData);

      const typeStr = cancelForm.requestType === 'cancel' ? 'Cancellation' : 'Rescheduling';
      const formattedDate = formatToMMDDYYYY(cancelForm.date);
      const messageText = `*${settings.brandName || 'Studio'}: ${typeStr.toUpperCase()} REQUEST*\n\n` +
        `*Name:* ${cancelForm.name}\n` +
        `*Phone:* ${cancelForm.phone}\n` +
        `*Date:* ${formattedDate}\n` +
        `*Time:* ${cancelForm.time}\n` +
        `*Professional:* ${requestData.professionalName}\n` +
        `*Notes:* ${cancelForm.notes || 'None'}\n\n` +
        `Please contact me to confirm. Thank you!`;

      const encodedMessage = encodeURIComponent(messageText);
      const countryCodeRaw = settings.whatsappCountryCode?.replace(/\D/g, '') || '1';
      let whatsappNumber = settings.whatsappNumber?.replace(/\D/g, '') || '';
      
      if (whatsappNumber.startsWith(countryCodeRaw)) {
        whatsappNumber = whatsappNumber.slice(countryCodeRaw.length);
      }
      
      const whatsappUrl = `https://wa.me/${countryCodeRaw}${whatsappNumber}?text=${encodedMessage}`;
      const smsUrl = `sms:${countryCodeRaw}${whatsappNumber}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodedMessage}`;

      setCancelRequestFinalized({ whatsappUrl, smsUrl });
      toast.success('Your request was submitted successfully!');
    } catch (error) {
      console.error('Error saving cancellation request:', error);
      toast.error('An error occurred. Please try again.');
    } finally {
      setIsSavingCancelRequest(false);
    }
  };

  const formatDuration = (minutes: number) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h}h`;
    return `${m}min`;
  };

  if (loading) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center p-4 min-h-[50vh] text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: settings?.primaryColor || '#865d39', borderTopColor: 'transparent' }} />
          <p className="text-xs font-bold uppercase tracking-widest opacity-60" style={{ color: settings?.textColor || '#000000' }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-grow flex flex-col items-center p-4 w-full overflow-x-hidden">
      <AnimatePresence mode="wait">
        {showWelcome ? (
          <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-grow flex flex-col items-center justify-center pt-12 pb-8 p-4 text-center w-full max-w-4xl mx-auto"
          >
            <div className="w-32 h-32 sm:w-56 sm:h-56 rounded-full bg-white p-1 shadow-xl mb-6 overflow-hidden flex items-center justify-center">
              <img src={settings.logo || DEFAULT_LOGO} alt="Logo" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
            </div>
            <h2 className="text-lg sm:text-3xl font-serif font-bold mb-2 whitespace-pre-wrap" style={{ color: settings.primaryColor }}>
              {settings.brandName || 'Easy Waxing'}
            </h2>
            <p className="text-[10px] sm:text-sm font-medium mb-12 sm:mb-24 max-w-[280px] sm:max-w-xs opacity-70" style={{ color: settings.textColor }}>
              {settings.welcomeSlogan || 'Bem-vindo ao seu momento de cuidado. Escolha como deseja começar:'}
            </p>

            <div className={cn(
              "grid gap-2 sm:gap-6 w-full max-w-4xl px-2 sm:px-4 justify-center items-center mx-auto",
              (() => {
                const count = [settings.showMakeup !== false, settings.showHair !== false, settings.showNails !== false, settings.showSpa !== false, settings.showClinic !== false, settings.showAesthetic !== false].filter(Boolean).length;
                if (count === 1) return "grid-cols-1 max-w-[200px]";
                if (count === 2) return "grid-cols-2 max-w-lg";
                if (count === 3) return "grid-cols-3";
                if (count === 4) return "grid-cols-2 max-w-lg";
                return "grid-cols-3";
              })()
            )}>
              {[
                { id: 'makeup', label: settings.makeupLabel || 'MAQUIAGEM', icon: settings.makeupIcon || settings.logo || "https://i.ibb.co/Qg2PjTC/make.png", show: settings.showMakeup !== false },
                { id: 'hair', label: settings.hairLabel || 'CABELO', icon: settings.hairIcon || settings.logo || "https://i.ibb.co/C3yNR5zM/black-hair.png", show: settings.showHair !== false },
                { id: 'nails', label: settings.nailsLabel || 'UNHAS', icon: settings.nailsIcon || settings.logo || "https://i.ibb.co/Xx8KrB9k/unhas.png", show: settings.showNails !== false },
                { id: 'spa', label: settings.spaLabel || 'SPA', icon: settings.spaIcon || settings.logo || "https://i.ibb.co/SD9BYwcn/patitour-2026-04-17-T085923-776.png", show: settings.showSpa !== false },
                { id: 'clinic', label: settings.clinicLabel || 'CLINIC', icon: settings.clinicIcon || settings.logo || "https://i.ibb.co/SD9BYwcn/patitour-2026-04-17-T085923-776.png", show: settings.showClinic !== false },
                { id: 'aesthetic', label: settings.aestheticLabel || 'ESTÉTICA', icon: settings.aestheticIcon || settings.logo || "https://i.ibb.co/SD9BYwcn/patitour-2026-04-17-T085923-776.png", show: settings.showAesthetic !== false }
              ].filter(d => d.show).map((dept) => (
                <button 
                  key={dept.id}
                  onClick={() => { setSelectedDepartment(dept.id as any); setShowWelcome(false); }}
                  className="flex flex-col items-center gap-2 group outline-none"
                >
                  <div className="w-full aspect-[4/5] rounded-2xl sm:rounded-3xl overflow-hidden shadow-xl border-2 sm:border-4 border-white/50 bg-white/10 backdrop-blur-md transition-all group-hover:scale-105 group-active:scale-95">
                    <img src={dept.icon} alt={dept.label} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <span className="text-[10px] sm:text-xs font-serif font-bold tracking-widest opacity-80 group-hover:opacity-100 uppercase text-center" style={{ color: settings.textColor }}>
                    {dept.label}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="menu"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full flex flex-col items-center pb-32"
          >
            {/* Botão Back Discreto */}
            <div className="w-full max-w-2xl px-4 flex justify-start -mb-8 z-10">
              <button 
                onClick={() => { setShowWelcome(true); setSelectedDepartment(undefined); }}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100 transition-all text-black"
              >
                <ArrowLeft size={14} /> {t.back}
              </button>
            </div>

            <div className="mt-8 mb-4 relative flex flex-col items-center">
              <div className="absolute top-0 right-[-100px] flex gap-2">
                {['pt', 'en'].map(lang => (
                  <button key={lang} onClick={() => setCurrentLang(lang as any)} className={cn("w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all", currentLang === lang ? "bg-black text-white border-black" : "bg-white text-black border-gray-200")}>
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="w-48 h-48 rounded-full bg-white p-1 shadow-2xl overflow-hidden flex items-center justify-center border-4 border-white">
                <img 
                  src={settings.logo || DEFAULT_LOGO} 
                  alt="Logo" 
                  className="w-full h-full object-cover rounded-full"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            <h1 className="text-4xl font-serif font-bold mb-2 text-center tracking-tight whitespace-pre-wrap" style={{ color: settings.primaryColor }}>
              {settings.brandName || 'Easy Waxing'}
            </h1>
            <p className="font-medium mb-12 text-center whitespace-pre-wrap" style={{ color: settings.textColor || '#3f2b1b' }}>
              {selectedDepartment === 'hair' ? (settings.hairSlogan || settings.slogan) : 
               selectedDepartment === 'makeup' ? (settings.makeupSlogan || settings.slogan) : 
               selectedDepartment === 'nails' ? (settings.nailsSlogan || settings.slogan) : 
               (settings.slogan || 'Your beauty experience, just a click away.')
            }
            </p>

            {settings.customMessageCardTitle && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-2xl glass p-8 rounded-[40px] mb-12 space-y-4 border border-white/40 shadow-2xl relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Sparkles size={120} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-md">
                    <MessageSquare size={24} style={{ color: settings.primaryColor }} />
                  </div>
                  <div>
                    <h3 className="text-xl font-serif font-black tracking-tight" style={{ color: settings.primaryColor }}>
                      {settings.customMessageCardTitle}
                    </h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Special Notice</p>
                  </div>
                </div>
                <div className="text-sm font-medium leading-relaxed opacity-70 whitespace-pre-wrap">
                  {settings.customMessageCardText}
                </div>
                {settings.customMessageCardUrl && (
                  <a 
                    href={settings.customMessageCardUrl.startsWith('http') ? settings.customMessageCardUrl : `https://${settings.customMessageCardUrl}`} 
                    target="_blank" 
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-lg"
                    style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                  >
                    LEARN MORE <ArrowRight size={14} />
                  </a>
                )}
              </motion.div>
            )}

      <div className="w-full max-w-2xl space-y-12">
        {categories.length > 0 ? (
          categories.map((category) => {
            const categoryProducts = products.filter(p => 
              p.categoryId === category.id && 
              p.isActive !== false &&
              (!selectedDepartment || p.department === selectedDepartment)
            );
            if (categoryProducts.length === 0) return null;

            return (
              <div key={category.id} className="space-y-6">
                <div className="border-b border-white/20 pb-2">
                  <h2 className="text-2xl font-serif font-bold italic" style={{ color: settings.primaryColor }}>
                    {category.title}
                  </h2>
                </div>
                <div className="space-y-4">
                  {categoryProducts.map((product) => (
                    <motion.div 
                      key={product.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      className="glass rounded-2xl p-4 flex gap-4 items-center"
                    >
                      <div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 bg-white/50 cursor-pointer" onClick={() => setSelectedProductForDetails(product)}>
                        <img src={product.image} alt={product.title} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-grow text-black">
                        <div className="flex justify-between items-start cursor-pointer" onClick={() => setSelectedProductForDetails(product)}>
                          <h3 className="text-xl font-serif font-bold mb-1 text-black">{product.title}</h3>
                          {product.duration && <span className="text-[10px] opacity-40 font-bold">{formatDuration(product.duration)}</span>}
                        </div>
                        <p className="text-sm line-clamp-2 mb-2 text-black cursor-pointer" onClick={() => setSelectedProductForDetails(product)}>{product.description}</p>
                        <button onClick={() => setSelectedProductForDetails(product)} className="text-[10px] font-bold uppercase tracking-wider underline opacity-60 hover:opacity-100">{t.viewDetails}</button>
                        <div className="flex flex-col items-end">
                          {product.priceType !== 'consult' && Number(product.price) > 0 && Number(product.oldPrice) > 0 && (
                            <span className="text-xs line-through opacity-40">
                              {currencySymbol} {Number(product.oldPrice).toFixed(2)}
                            </span>
                          )}
                          <p className="text-lg font-bold" style={{ color: settings.primaryColor }}>
                            {product.priceType === 'consult' ? t.consultPrice : 
                             `${product.priceType === 'starting' ? t.startingAt + ' ' : ''}${currencySymbol} ${(Number(product.price) > 0 ? Number(product.price) : (Number(product.oldPrice) || 0)).toFixed(2)}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        {cart.filter(item => item.productId === product.id).length > 0 && (
                          <div className="flex flex-col items-center gap-2">
                            <button 
                              onClick={() => addToCart(product)}
                              className="p-2 rounded-full shadow-lg"
                              style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                            >
                              <Plus size={20} />
                            </button>
                            <span className="font-bold">
                              {cart.filter(item => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0)}
                            </span>
                            <button 
                              onClick={() => {
                                const item = cart.find(i => i.productId === product.id);
                                if (item) removeFromCart(item.id);
                              }}
                              className="p-2 rounded-full bg-white shadow-md border border-gray-200"
                              style={{ color: '#000000' }}
                            >
                              <Minus size={20} style={{ color: '#000000' }} />
                            </button>
                          </div>
                        )}
                        {cart.filter(item => item.productId === product.id).length === 0 && (
                          <button 
                            onClick={() => addToCart(product)}
                            className="p-3 rounded-full shadow-lg"
                            style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                          >
                            <Plus size={24} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center p-12 opacity-60 glass rounded-2xl">
            {currentLang === 'en' ? 'No products found.' : 'Nenhum produto encontrado.'}
          </div>
        )}
        <div className="w-full max-w-2xl px-4 mt-12 flex justify-center pb-8">
          <button
            onClick={() => setIsCancelModalOpen(true)}
            className="text-[10px] font-bold uppercase tracking-widest opacity-50 hover:opacity-100 transition-all border border-black/20 hover:border-black/50 px-5 py-2.5 rounded-full text-black flex items-center gap-1.5 bg-white/30 backdrop-blur-sm"
          >
            <CalendarX size={14} /> Request Cancellation or Rescheduling
          </button>
        </div>
      </div>

      <AnimatePresence>
        {cartItemsCount > 0 && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-6 left-4 right-4 max-w-2xl mx-auto z-40"
          >
            <button 
              onClick={() => {
                setCheckoutStep('summary');
                setIsModalOpen(true);
              }}
              className="w-full h-16 rounded-2xl shadow-2xl flex items-center justify-between px-6 font-bold text-lg transition-transform active:scale-95"
              style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
            >
              <div className="flex items-center gap-3">
                <ShoppingBag size={24} />
                <span>{t.cartTitle}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-white/20 px-2 py-1 rounded-lg text-sm">{cartItemsCount} {currentLang === 'pt' ? 'itens' : 'items'}</span>
                <span>{currencySymbol} {cartTotal.toFixed(2)}</span>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!orderFinalized) {
                  setIsModalOpen(false);
                  setCheckoutStep('summary');
                }
              }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg glass rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-white/40 shadow-black/20"
            >
              {orderFinalized ? (
                <div className="p-8 text-center space-y-6 overflow-y-auto">
                  <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={40} />
                  </div>
                  <h2 className="text-3xl font-serif font-bold text-black leading-tight">
                    {currentLang === 'pt' ? 'Agendamento Realizado!' : 'Appointment Confirmed!'}
                  </h2>
                  <p className="text-gray-600 max-w-sm mx-auto text-sm leading-relaxed">
                    {currentLang === 'pt' 
                      ? 'Seu agendamento foi salvo. Para garantir sua vaga, envie agora a confirmação pelo WhatsApp ou por SMS.' 
                      : 'Your appointment is saved. To secure your spot, please send details via WhatsApp or SMS now.'}
                  </p>

                  <div className="grid grid-cols-1 gap-4 pt-4">
                    <a 
                      href={orderFinalized.whatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-3 bg-[#25D366] text-white py-4 rounded-2xl font-black hover:scale-[1.02] transition-all shadow-lg text-sm uppercase tracking-widest"
                    >
                      <MessageCircle size={20} fill="currentColor" /> {currentLang === 'pt' ? 'Enviar WhatsApp' : 'Send WhatsApp'}
                    </a>
                    <a 
                      href={orderFinalized.smsUrl}
                      className="flex items-center justify-center gap-3 bg-[#007AFF] text-white py-4 rounded-2xl font-black hover:scale-[1.02] transition-all shadow-lg text-sm uppercase tracking-widest"
                    >
                      <MessageSquare size={20} /> {currentLang === 'pt' ? 'Enviar por SMS' : 'Send via SMS'}
                    </a>
                  </div>

                  <button 
                    onClick={() => {
                      setIsModalOpen(false);
                      setOrderFinalized(null);
                    }}
                    className="text-black/40 text-[10px] font-black uppercase tracking-widest hover:text-black transition-colors pt-4 block w-full"
                  >
                    {currentLang === 'pt' ? 'Fechar e Voltar' : 'Close and Back'}
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-2xl font-serif font-bold" style={{ color: '#000000' }}>
                      {checkoutStep === 'summary' ? t.cartTitle : t.finish}
                    </h2>
                    <button 
                      onClick={() => {
                        setIsModalOpen(false);
                        setCheckoutStep('summary');
                      }} 
                      className="p-2 hover:bg-gray-100 rounded-full"
                      style={{ color: '#000000' }}
                    >
                      <X size={24} />
                    </button>
                  </div>
              
              <div className="p-6 overflow-y-auto">
                {checkoutStep === 'summary' ? (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      {(() => {
                        const hasScheduledItems = cart.some(i => i.appointmentTime);
                        return cart.map((item) => {
                          const product = products.find(p => p.id === item.productId);
                          if (!product) return null;
                          return (
                            <div key={item.id} className="flex flex-col gap-2 bg-white/40 p-3 rounded-2xl border border-white/20">
                              <div className="flex items-center gap-4">
                                <img src={product.image} alt={product.title} className="w-12 h-12 rounded-lg object-cover" />
                                <div className="flex-grow">
                                  <div className="flex justify-between items-start">
                                    <h4 className="font-bold text-sm" style={{ color: '#000000' }}>{product.title}</h4>
                                    <div className="flex items-center gap-2">
                                      {product.duration && <span className="text-[10px] opacity-40">{formatDuration(product.duration)}</span>}
                                      <button 
                                        onClick={() => {
                                          setCart(prev => prev.filter(i => i.id !== item.id));
                                          toast.success(currentLang === 'pt' ? 'Serviço removido!' : 'Service removed!');
                                        }}
                                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all"
                                        title={currentLang === 'pt' ? 'Remover serviço' : 'Remove service'}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                  {item.mealOptions && (
                                    <div className="text-[10px] leading-tight" style={{ color: 'rgba(0, 0, 0, 0.6)' }}>
                                      {item.mealOptions.removals.length > 0 && `${t.excludeIngredients}: ${item.mealOptions.removals.join(', ')}`}
                                      {item.mealOptions.removals.length > 0 && item.mealOptions.sides.length > 0 && ' • '}
                                      {item.mealOptions.sides.length > 0 && `${t.chooseSides}: ${item.mealOptions.sides.map(s => s.name).join(', ')}`}
                                    </div>
                                  )}
                                  <div className="flex justify-between items-end mt-1">
                                    {item.appointmentTime ? (
                                      <div className="flex flex-col items-start gap-1">
                                        <span className="text-[10px] font-extrabold text-pink-600 uppercase tracking-wider">
                                          📅 {item.appointmentDate} • ⏰ {formatTimeToAMPM(item.appointmentTime)}
                                        </span>
                                        <button 
                                          onClick={() => {
                                            const itemIdx = cart.findIndex(c => c.id === item.id);
                                            if (itemIdx >= 0) {
                                              setCurrentSchedulingIndex(itemIdx);
                                              setCheckoutStep('schedule');
                                            }
                                          }}
                                          className="text-[9px] font-black uppercase bg-pink-50 hover:bg-pink-100 text-pink-700 border border-pink-100/50 px-2 py-0.5 rounded-lg transition-all active:scale-95 shrink-0 flex items-center gap-1 shadow-sm"
                                        >
                                          ✏️ {currentLang === 'pt' ? 'Alterar' : 'Edit'}
                                        </button>
                                      </div>
                                    ) : hasScheduledItems ? (
                                      <span className="text-[10px] font-bold text-pink-600 uppercase tracking-wider">{currentLang === 'en' ? 'Pending Time' : 'Horário Pendente'}</span>
                                    ) : (
                                      <div />
                                    )}
                                    <div className="flex flex-col items-end">
                                      {product.priceType !== 'consult' && product.price > 0 && product.oldPrice && product.oldPrice > 0 && (
                                        <span className="text-[10px] line-through opacity-20">
                                          {currencySymbol} {product.oldPrice.toFixed(2)}
                                        </span>
                                      )}
                                      <p className="text-sm font-bold" style={{ color: settings.primaryColor }}>
                                        {product.priceType === 'consult' ? t.consultPrice : 
                                         `${product.priceType === 'starting' ? t.startingAt + ' ' : ''}${currencySymbol} ${(((product.price > 0 ? product.price : (product.oldPrice || 0)) + (item.mealOptions?.sides.reduce((sum, s) => sum + s.price, 0) || 0)) * item.quantity).toFixed(2)}`}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            <div className="flex items-center justify-end gap-3 mt-1">
                              <button 
                                onClick={() => removeFromCart(item.id)}
                                className="w-8 h-8 rounded-full bg-white flex items-center justify-center opacity-80 shadow-sm border border-gray-100"
                                style={{ color: '#000000' }}
                              >
                                <Minus size={16} style={{ color: '#000000' }} />
                              </button>
                              <span className="font-bold text-sm" style={{ color: '#000000' }}>{item.quantity}</span>
                              <button 
                                onClick={() => {
                                  setCart(prev => prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
                                }}
                                className="w-8 h-8 rounded-full text-white flex items-center justify-center shadow-sm"
                                style={{ backgroundColor: settings.primaryColor }}
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    })()}
                    </div>
                    
                    <div className="pt-4 border-t border-gray-200 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-lg font-bold" style={{ color: '#000000' }}>{t.total}</span>
                          {cart.length === 1 && cartTotalDuration > 0 && (
                            <span className="text-xs opacity-60" style={{ color: '#000000' }}>
                              {t.totalDuration}: {formatDuration(cartTotalDuration)}
                            </span>
                          )}
                        </div>
                        <span className="text-2xl font-bold" style={{ color: settings.primaryColor }}>
                          {currencySymbol} {cartTotal.toFixed(2)}
                        </span>
                      </div>
                      {cart.some(item => products.find(p => p.id === item.productId)?.priceType === 'consult') && (
                        <div className="p-3 rounded-xl bg-yellow-50 border border-yellow-100 text-[10px] text-yellow-800 font-medium">
                          {t.consultMessage}
                        </div>
                      )}
                    </div>

                    {(() => {
                      const allScheduled = cart.every(item => item.appointmentDate && item.appointmentTime);
                      if (allScheduled) {
                        return (
                          <div className="flex flex-col gap-3">
                            <button 
                              onClick={() => {
                                setCheckoutStep('form');
                              }}
                              className="w-full py-4 rounded-xl font-bold text-lg shadow-xl"
                              style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                            >
                              {currentLang === 'pt' ? 'Finalizar Agendamento' : 'Finalize Booking'}
                            </button>
                            <button 
                              onClick={() => {
                                setIsModalOpen(false);
                                setShowWelcome(true);
                                setSelectedDepartment(null);
                              }}
                              className="w-full py-3 rounded-xl font-bold text-sm text-center transition-all bg-white/40 border border-black/10 hover:bg-white/60 text-black"
                            >
                              {currentLang === 'pt' ? '➕ Escolher outro serviço' : '➕ Choose another service'}
                            </button>
                          </div>
                        );
                      }

                      return (
                        <button 
                          onClick={() => {
                            const idx = cart.findIndex(item => !item.appointmentDate || !item.appointmentTime);
                            setCurrentSchedulingIndex(idx >= 0 ? idx : 0);
                            setCheckoutStep('schedule');
                          }}
                          className="w-full py-4 rounded-xl font-bold text-lg shadow-xl"
                          style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                        >
                          {t.pickupDate}
                        </button>
                      );
                    })()}
                  </div>
                ) : checkoutStep === 'schedule' ? (() => {
                  const item = cart[currentSchedulingIndex];
                  if (!item) return null;
                  const prod = products.find(p => p.id === item.productId);
                  if (!prod) return null;
                  const dept = prod.department;

                  const filteredProfs = professionals
                    .filter(p => {
                      if (p.isActive === false) return false;
                      
                      const matchesDept = !dept || p.departments.includes(dept);
                      if (!matchesDept) return false;
                      
                      // Verify if professional is allowed to execute this particular product
                      if (prod && prod.allowedProfessionals && prod.allowedProfessionals.length > 0) {
                        if (!prod.allowedProfessionals.includes(p.id)) return false;
                      }

                      // Verify if professional is OPEN on the chosen date
                      if (item.appointmentDate) {
                        const dateStr = item.appointmentDate;
                        const tempDate = new Date(dateStr + 'T00:00:00');
                        const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                        const dayOfWeek = daysList[tempDate.getDay()];
                        
                        // Check holiday/closure
                        const isHoliday = (settings.holidays || []).some((h: any) => {
                          if (typeof h === 'string') return h === dateStr;
                          if (!h || h.date !== dateStr) return false;
                          if (!h.professionalId) {
                            const hDepts = Array.isArray(h.departments) ? h.departments : ['all'];
                            const isDeptMatch = hDepts.includes('all') || (dept && hDepts.includes(dept));
                            return isDeptMatch && !h.startTime && !h.endTime;
                          }
                          return h.professionalId === p.id && !h.startTime && !h.endTime;
                        });
                        
                        if (isHoliday) return false;

                        // Get day schedule
                        let daySchedule = p.workingHours?.[dayOfWeek as keyof WorkingHours];
                        if (!daySchedule) {
                          const scheduleKey = dept === 'hair' ? 'hairWorkingHours' : dept === 'makeup' ? 'makeupWorkingHours' : dept === 'nails' ? 'nailsWorkingHours' : 'workingHours';
                          daySchedule = (settings as any)[scheduleKey]?.[dayOfWeek];
                        }
                        if (!daySchedule && dept) {
                          daySchedule = (settings as any).workingHours?.[dayOfWeek];
                        }
                        if (!daySchedule) {
                          daySchedule = { isOpen: true, start: '09:00', end: '18:00' };
                        }

                        // Check extra hours
                        const dP2 = dateStr.split('-');
                        const formattedDateForLoop = `${dP2[1]}/${dP2[2]}/${dP2[0]}`;
                        const relevantExtras = (horariosExtras || []).filter(h => 
                          h.profId === p.id && 
                          h.date === formattedDateForLoop
                        );

                        if (!daySchedule.isOpen && relevantExtras.length === 0) {
                          return false;
                        }
                      }

                      return true;
                    })
                    .sort((a, b) => {
                      const currentItemDept = dept || '';
                      const orderA = a.deptOrder?.[currentItemDept] ?? a.order ?? 0;
                      const orderB = b.deptOrder?.[currentItemDept] ?? b.order ?? 0;
                      return orderA - orderB;
                    });

                  const isSavedProfValid = item.professionalId && filteredProfs.some(p => p.id === item.professionalId);
                  const selectedId = isSavedProfValid ? item.professionalId : (filteredProfs[0] ? filteredProfs[0].id : '');

                  return (
                    <div className="space-y-6">
                      {/* Progress Indicator */}
                      <div className="flex justify-between items-center bg-gray-50/50 p-3 rounded-2xl border border-black/5">
                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                          {currentLang === 'pt' ? 'Etapa de Agendamento' : 'Scheduling Progress'}
                        </span>
                        <span className="text-xs font-black text-black px-2 py-0.5 rounded-full bg-white border border-black/10">
                          {currentSchedulingIndex + 1} / {cart.length}
                        </span>
                      </div>

                      {/* Current Service Card */}
                      <div className="bg-white border p-4 rounded-2xl flex items-center gap-4 shadow-sm">
                        <img 
                          src={prod.image} 
                          alt={prod.title} 
                          className="w-14 h-14 object-cover rounded-xl border border-black/10 shrink-0" 
                        />
                        <div className="flex-grow min-w-0">
                          <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 block mb-0.5">
                            {dept === 'hair' ? (settings.hairLabel || 'CABELO') : 
                             dept === 'makeup' ? (settings.makeupLabel || 'MAQUIAGEM') : 
                             dept === 'nails' ? (settings.nailsLabel || 'UNHAS') : 
                             dept === 'spa' ? (settings.spaLabel || 'SPA') : 
                             dept === 'clinic' ? (settings.clinicLabel || 'CLINIC') : 
                             dept === 'aesthetic' ? (settings.aestheticLabel || 'ESTÉTICA') : 'SERVIÇO'}
                          </span>
                          <h4 className="font-serif font-black text-sm text-black truncate leading-snug">{prod.title}</h4>
                          {item.variation && (
                            <span className="text-[10px] text-gray-500 font-bold uppercase block mt-0.5">({item.variation.name})</span>
                          )}
                          <span className="text-[10px] text-gray-400 block mt-0.5 font-bold">
                            {currentLang === 'pt' ? 'Duração:' : 'Duration:'} {formatDuration(((prod.duration || 0) + (item.variation?.duration || 0)) * item.quantity)}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-4">
                        {/* Date selection for the current item */}
                        <div className="space-y-2">
                          <label className="text-sm font-bold block">{t.pickupDate}</label>
                          <input 
                            type="date" 
                            placeholder={t.pickupDatePlaceholder}
                            className="w-full p-4 rounded-xl border border-gray-200 outline-none focus:ring-2 text-black"
                            style={{ '--tw-ring-color': settings.primaryColor } as any}
                            min={(() => {
                              const tomorrow = new Date();
                              tomorrow.setDate(tomorrow.getDate() + 1);
                              const year = tomorrow.getFullYear();
                              const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
                              const day = String(tomorrow.getDate()).padStart(2, '0');
                              return `${year}-${month}-${day}`;
                            })()}
                            value={item.appointmentDate || ''}
                            onChange={e => {
                              const updatedDate = e.target.value;
                              const defaultProfId = filteredProfs[0]?.id || '';
                              setFormData({ ...formData, appointmentDate: updatedDate, appointmentTime: '' });
                              setCart(prev => prev.map((it, idx) => {
                                if (idx === currentSchedulingIndex) {
                                  return { 
                                    ...it, 
                                    appointmentDate: updatedDate, 
                                    appointmentTime: '',
                                    professionalId: defaultProfId
                                  };
                                }
                                return it;
                              }));
                            }}
                          />
                        </div>

                        {/* Display Professional list only if date is chosen */}
                        {item.appointmentDate && (
                          <div className="space-y-4">
                            {filteredProfs.length > 0 && (
                              <div className="space-y-4">
                                <label className="text-sm font-bold block">
                                  {currentLang === 'pt' ? 'Escolha o Profissional' : 'Choose Professional'}
                                </label>
                                <div className="flex flex-col gap-4">
                                  <div className="flex items-center gap-4">
                                    {/* Featured First Professional */}
                                    {(() => {
                                      const firstProf = filteredProfs[0];
                                      const otherProfs = filteredProfs.slice(1);
                                      return (
                                        <>
                                          <button 
                                            type="button"
                                            onClick={() => {
                                              setSelectedProfessionalForDept({ ...selectedProfessionalForDept, [dept || '']: firstProf.id });
                                              setCart(prev => prev.map((it, idx) => {
                                                if (idx === currentSchedulingIndex) {
                                                  return { ...it, professionalId: firstProf.id, appointmentTime: '' };
                                                }
                                                return it;
                                              }));
                                            }}
                                            className={cn(
                                              "flex flex-col items-center gap-3 p-4 rounded-3xl border-2 transition-all flex-1",
                                              selectedId === firstProf.id
                                              ? "bg-black text-white border-black shadow-lg scale-105"
                                              : "bg-white/40 border-white/20 hover:border-black/20 text-black"
                                            )}
                                          >
                                            <div className={cn(
                                              "w-20 h-20 rounded-full overflow-hidden border-4 shadow-md transition-all",
                                              selectedId === firstProf.id ? "border-white" : "border-white/50"
                                            )}>
                                              <img src={firstProf.avatar || DEFAULT_LOGO} alt={firstProf.name} className="w-full h-full object-cover" />
                                            </div>
                                            <div className="text-center">
                                              <span className="text-xs font-bold block">{firstProf.name}</span>
                                            </div>
                                          </button>

                                          {/* Other Professionals Section */}
                                          {otherProfs.length > 0 && (
                                            <div className="flex flex-col gap-2 shrink-0">
                                              {otherProfs.map(prof => (
                                                <button 
                                                  key={prof.id}
                                                  type="button"
                                                  onClick={() => {
                                                    setSelectedProfessionalForDept({ ...selectedProfessionalForDept, [dept || '']: prof.id });
                                                    setCart(prev => prev.map((it, idx) => {
                                                      if (idx === currentSchedulingIndex) {
                                                        return { ...it, professionalId: prof.id, appointmentTime: '' };
                                                      }
                                                      return it;
                                                    }));
                                                  }}
                                                  className={cn(
                                                    "flex items-center gap-3 p-2 pr-4 rounded-2xl border-2 transition-all w-32",
                                                    selectedId === prof.id
                                                    ? ""
                                                    : "bg-white/40 border-white/20 text-black"
                                                  )}
                                                  style={selectedId === prof.id ? { backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor), borderColor: settings.primaryColor } : {}}
                                                >
                                                  <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white shrink-0">
                                                    <img src={prof.avatar || DEFAULT_LOGO} alt={prof.name} className="w-full h-full object-cover" />
                                                  </div>
                                                  <span className="text-[10px] font-bold truncate leading-tight">{prof.name.split(' ')[0]}</span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Time select option details */}
                            <label className="text-sm font-bold block">{t.appointmentTime}</label>
                            <div className="grid grid-cols-3 gap-2">
                              {(() => {
                                const dateStr = item.appointmentDate;
                                if (!dateStr) return null;

                                const date = new Date(dateStr + 'T00:00:00');
                                const selectedProfId = selectedId;

                                if (!selectedProfId) {
                                  return <div className="col-span-3 text-center p-4 opacity-40 italic text-xs">{currentLang === 'pt' ? 'Nenhum profissional disponível para este serviço.' : 'No professional available for this service.'}</div>;
                                }

                                // Busy sessions already booked inside this order in other indexes
                                const scheduledToday = cart.filter((i, idx) => idx !== currentSchedulingIndex && i.appointmentTime && i.appointmentDate === dateStr);
                                
                                const unscheduledDuration = ((prod?.duration || 0) + (item.variation?.duration || 0)) * item.quantity;

                                const sessionBusyIntervals = scheduledToday.map(sessionItem => {
                                  const prodOther = products.find(p => p.id === sessionItem.productId);
                                  const start = formatTimeForDate(sessionItem.appointmentTime!, dateStr);
                                  if (!start || isNaN(start.getTime())) return null;
                                  const dur = ((prodOther?.duration || 0) + (sessionItem.variation?.duration || 0)) * sessionItem.quantity;
                                  return { start, end: new Date(start.getTime() + dur * 60000) };
                                }).filter(Boolean) as {start: Date, end: Date}[];

                                const isHoliday = (settings.holidays || []).some((h: string | Holiday) => {
                                  if (typeof h === 'string') return h === dateStr;
                                  if (!h) return false;
                                  const isDateMatch = h.date === dateStr;
                                  if (!isDateMatch) return false;

                                  // General or department closures
                                  if (!h.professionalId) {
                                    const hDepts = Array.isArray(h.departments) ? h.departments : ['all'];
                                    const isDeptMatch = hDepts.includes('all') || (dept && hDepts.includes(dept));
                                    return isDeptMatch && !h.startTime && !h.endTime;
                                  }

                                  // Specific professional closure
                                  return h.professionalId === selectedProfId && !h.startTime && !h.endTime;
                                });

                                if (isHoliday) {
                                  return <div className="col-span-3 text-center p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{currentLang === 'en' ? 'RESERVED / CLOSED ON THIS DAY' : 'FECHADO NESTE DIA'}</div>;
                                }

                                const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                                 const dayOfWeek = daysList[date.getDay()];
                                const prof = professionals.find(p => p.id === selectedProfId);
                                let daySchedule = prof?.workingHours?.[dayOfWeek as keyof WorkingHours];

                                if (!daySchedule) {
                                  const scheduleKey = dept === 'hair' ? 'hairWorkingHours' : dept === 'makeup' ? 'makeupWorkingHours' : dept === 'nails' ? 'nailsWorkingHours' : 'workingHours';
                                  daySchedule = (settings as any)[scheduleKey]?.[dayOfWeek];
                                }
                                
                                // Fallback
                                if (!daySchedule && dept) {
                                  daySchedule = (settings as any).workingHours?.[dayOfWeek];
                                }

                                if (!daySchedule) {
                                  daySchedule = { isOpen: true, start: '09:00', end: '18:00' };
                                }

                                const dP2 = dateStr.split('-');
                                const formattedDateForLoop = `${dP2[1]}/${dP2[2]}/${dP2[0]}`;
                                const relevantExtras = horariosExtras.filter(h => 
                                  h.profId === selectedProfId && 
                                  h.date === formattedDateForLoop
                                );

                                if (!daySchedule.isOpen && relevantExtras.length === 0) {
                                  return <div className="col-span-3 text-center p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{currentLang === 'en' ? 'CLOSED ON THIS DAY' : 'FECHADO NESTE DIA'}</div>;
                                }

                                const slots: string[] = [];
                                let loopStart = daySchedule.isOpen ? daySchedule.start : '23:59';
                                let loopEnd = daySchedule.isOpen ? daySchedule.end : '00:00';

                                relevantExtras.forEach(h => {
                                  if (h.start < loopStart) loopStart = h.start;
                                  if (h.end > loopEnd) loopEnd = h.end;
                                });

                                if (loopStart === '23:59' && relevantExtras.length === 0) {
                                  return <div className="col-span-3 text-center p-4 bg-red-50 text-red-600 rounded-xl text-xs font-bold">{currentLang === 'en' ? 'CLOSED ON THIS DAY' : 'FECHADO NESTE DIA'}</div>;
                                }

                                const now = new Date();
                                let current = new Date(`${dateStr}T${loopStart}:00`);
                                const end = new Date(`${dateStr}T${loopEnd}:00`);

                                while (current < end) {
                                  const isPastSlot = current < now;
                                  const timeStr = current.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                                  const slotEnd = new Date(current.getTime() + unscheduledDuration * 60000);

                                  // Check extra opening hours slots
                                  const dP = dateStr.split('-');
                                  const formattedDateLocal = `${dP[1]}/${dP[2]}/${dP[0]}`;
                                  const extraSlot = (horariosExtras || []).find(h => 
                                    h.profId === selectedProfId && 
                                    h.date === formattedDateLocal &&
                                    current >= new Date(`${dateStr}T${h.start}:00`) &&
                                    slotEnd <= new Date(`${dateStr}T${h.end}:00`)
                                  );
                                  
                                  const isOccupied = !extraSlot && allOrders.some(order => {
                                    if (order.status === 'cancelled' || order.status === 'no-show') return false;
                                    return order.items.some(item => {
                                      const itemDate = item.appointmentDate || order.appointmentDate;
                                      if (itemDate !== dateStr) return false;

                                      const compareProfId = item.professionalId || order.professionalId || '';
                                      if (compareProfId !== selectedProfId) return false;

                                      const itemStart = formatTimeForDate(item.appointmentTime || order.appointmentTime, dateStr);
                                      if (!itemStart || isNaN(itemStart.getTime())) return false;

                                      const itemDur = (item.duration || 0) * (item.quantity || 1);
                                      const itemEnd = new Date(itemStart.getTime() + itemDur * 60000);
                                      const isInRange = current >= itemStart && current < itemEnd;
                                      if (isInRange && order.gapStart && order.gapEnd) {
                                        const gapS = formatTimeForDate(order.gapStart, dateStr);
                                        const gapE = formatTimeForDate(order.gapEnd, dateStr);
                                        if (gapS && gapE && current >= gapS && current < gapE) return false;
                                      }
                                      return isInRange;
                                    });
                                  });

                                  if (!isOccupied) {
                                    // session conflict prevention link
                                    const conflictWithSession = sessionBusyIntervals.some(interval => {
                                      return (current < interval.end && slotEnd > interval.start);
                                    });

                                    if (slotEnd <= end && !conflictWithSession) {
                                      const overlaps = !extraSlot && allOrders.some(order => {
                                        if (order.status === 'cancelled' || order.status === 'no-show') return false;
                                        return order.items.some(item => {
                                          const itemDate = item.appointmentDate || order.appointmentDate;
                                          if (itemDate !== dateStr) return false;

                                          const compareProfId = item.professionalId || order.professionalId || '';
                                          if (compareProfId !== selectedProfId) return false;

                                          const itemStart = formatTimeForDate(item.appointmentTime || order.appointmentTime, dateStr);
                                          if (!itemStart || isNaN(itemStart.getTime())) return false;

                                          const itemDur = (item.duration || 0) * (item.quantity || 1);
                                          const itemEnd = new Date(itemStart.getTime() + itemDur * 60000);
                                          const overlap = (current < itemEnd && slotEnd > itemStart);
                                          if (overlap && order.gapStart && order.gapEnd) {
                                            const gS = formatTimeForDate(order.gapStart, dateStr);
                                            const gE = formatTimeForDate(order.gapEnd, dateStr);
                                            if (gS && gE && current >= gS && slotEnd <= gE) return false;
                                          }
                                          return overlap;
                                        });
                                      });
                                      
                                      const isBlockedPeriod = (settings.holidays || []).some((h: any) => {
                                        if (typeof h === 'string' || !h) return false;
                                        if (h.date !== dateStr) return false;
                                        if (!h.startTime || !h.endTime) return false;
                                        if (h.professionalId && h.professionalId !== selectedProfId) return false;
                                        if (!h.professionalId) {
                                          const hDepts = Array.isArray(h.departments) ? h.departments : ['all'];
                                          const isDeptMatch = hDepts.includes('all') || (dept && hDepts.includes(dept));
                                          if (!isDeptMatch) return false;
                                        }
                                        const bStart = new Date(`${dateStr}T${h.startTime}:00`);
                                        const bEnd = new Date(`${dateStr}T${h.endTime}:00`);
                                        return current < bEnd && slotEnd > bStart;
                                      });

                                      if (!isPastSlot) {
                                        if (!isBlockedPeriod && extraSlot) {
                                          if (!overlaps) slots.push(timeStr);
                                        } else if (!isBlockedPeriod && !overlaps && daySchedule.isOpen) {
                                          const slotTime = new Date(`${dateStr}T${timeStr}:00`);
                                          const busStart = new Date(`${dateStr}T${daySchedule.start}:00`);
                                          const busEnd = new Date(`${dateStr}T${daySchedule.end}:00`);
                                          if (slotTime >= busStart && slotEnd <= busEnd) {
                                            slots.push(timeStr);
                                          }
                                        }
                                      }
                                    }
                                  }
                                  current = new Date(current.getTime() + 30 * 60000);
                                }

                                if (slots.length === 0) return <div className="col-span-3 text-center p-4 bg-gray-50 text-black font-semibold rounded-xl text-xs">{currentLang === 'en' ? 'No available slots' : 'Sem horários disponíveis'}</div>;

                                return slots.map(slot => {
                                  const ampmTime = formatTimeToAMPM(slot);
                                  const isSelected = item.appointmentTime === ampmTime;
                                  return (
                                    <button 
                                      key={slot}
                                      type="button"
                                      onClick={() => {
                                        setFormData({ ...formData, appointmentTime: ampmTime });
                                        setCart(prev => prev.map((it, idx) => {
                                          if (idx === currentSchedulingIndex) {
                                            return { 
                                              ...it, 
                                              appointmentTime: ampmTime,
                                              professionalId: selectedProfId 
                                            };
                                          }
                                          return it;
                                        }));
                                      }}
                                      className={cn(
                                        "p-3 rounded-xl border text-sm font-bold transition-all text-black",
                                        isSelected 
                                        ? "shadow-lg scale-105" 
                                        : "hover:bg-gray-50 bg-white"
                                      )}
                                      style={isSelected ? { backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor), borderColor: settings.primaryColor } : {}}
                                    >
                                      {ampmTime}
                                    </button>
                                  );
                                });
                              })()}
                            </div>

                            {item.appointmentDate && (
                              <div className="mt-6 p-6 rounded-[2rem] border border-black/10 text-center space-y-4 bg-white/40 shadow-sm">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-black">
                                  Can't find your ideal time?
                                </h4>
                                <p className="text-xs opacity-60 px-4 leading-relaxed text-black">
                                  Join our waitlist! We'll notify you as soon as a slot opens up.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setIsWaitlistModalOpen(true)}
                                  className="w-full py-3 text-white rounded-xl font-bold uppercase text-xs tracking-widest hover:opacity-90 active:scale-95 transition-all shadow-md"
                                  style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                                >
                                  Join the Waitlist
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-4">
                        <button 
                          type="button"
                          onClick={() => {
                            if (currentSchedulingIndex > 0) {
                              const prevItem = cart[currentSchedulingIndex - 1];
                              const prevForm = getAnamneseFormForItem(prevItem, products, anamneseForms);
                              if (prevForm) {
                                setCurrentSchedulingIndex(currentSchedulingIndex - 1);
                                setActiveAnamneseForm(prevForm);
                                setCheckoutStep('anamnese');
                              } else {
                                setCurrentSchedulingIndex(currentSchedulingIndex - 1);
                              }
                            } else {
                              setCheckoutStep('summary');
                            }
                          }} 
                          className="flex-1 py-4 border rounded-xl font-bold opacity-60 text-black bg-white"
                        >
                          {t.back}
                        </button>
                        <button 
                          type="button"
                          disabled={!item.appointmentDate || !item.appointmentTime}
                          onClick={() => {
                            const activeForm = getAnamneseFormForItem(item, products, anamneseForms);

                            if (activeForm) {
                              setActiveAnamneseForm(activeForm);
                              setCheckoutStep('anamnese');
                              return;
                            }

                            if (currentSchedulingIndex < cart.length - 1) {
                              setCurrentSchedulingIndex(prev => prev + 1);
                            } else {
                              setCheckoutStep('summary');
                              setIsModalOpen(false);
                              toast.success(currentLang === 'pt' 
                                ? 'Agendamento adicionado com sucesso! Você pode continuar escolhendo serviços ou finalizar clicando no carrinho.' 
                                : 'Booking added successfully! You can continue choosing services or finalize by clicking on the cart.'
                              );
                            }
                          }}
                          className="flex-[2] py-4 rounded-xl font-bold disabled:opacity-30 transition-all shadow-xl text-white"
                          style={{ backgroundColor: settings.primaryColor }}
                        >
                          {t.next}
                        </button>
                      </div>
                    </div>
                  );
                })() : checkoutStep === 'upsell' ? (
                  <div className="space-y-8 py-4">
                    <div className="text-center space-y-4">
                      <div 
                        className="w-20 h-20 rounded-full flex items-center justify-center mx-auto shadow-inner"
                        style={{ backgroundColor: `${settings.primaryColor}15`, color: settings.primaryColor }}
                      >
                        <Sparkles size={40} />
                      </div>
                      <h3 className="text-2xl font-serif font-bold text-black px-4 leading-tight">{t.upsellTitle}</h3>
                      <p className="text-sm opacity-60 px-6 italic font-medium">{t.upsellText}</p>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: 'hair', label: settings.hairLabel || 'CABELO', icon: Scissors, show: settings.showHair !== false },
                        { id: 'makeup', label: settings.makeupLabel || 'MAQUIAGEM', icon: Palette, show: settings.showMakeup !== false },
                        { id: 'nails', label: settings.nailsLabel || 'UNHAS', icon: Sparkles, show: settings.showNails !== false },
                        { id: 'spa', label: settings.spaLabel || 'SPA', icon: Sparkles, show: settings.showSpa !== false },
                        { id: 'clinic', label: settings.clinicLabel || 'CLINIC', icon: Sparkles, show: settings.showClinic !== false },
                        { id: 'aesthetic', label: settings.aestheticLabel || 'ESTÉTICA', icon: Sparkles, show: settings.showAesthetic !== false }
                      ].filter(d => d.show && !cart.some(item => item.department === d.id)).map(dept => (
                        <button 
                          key={dept.id}
                          onClick={() => {
                            setIsModalOpen(false);
                            setSelectedDepartment(dept.id as any);
                            toast.info(currentLang === 'pt' ? `Agora você pode adicionar serviços de ${dept.label}!` : `Now you can add ${dept.label} services!`);
                          }}
                          className="flex flex-col items-center gap-2 p-4 glass rounded-2xl hover:scale-105 transition-all text-black border border-white/20"
                        >
                          <dept.icon size={28} style={{ color: settings.primaryColor }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-center">{dept.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-col gap-3 pt-4">
                      <button 
                        onClick={() => {
                          let activeForm: AnamneseForm | null = null;
                          for (const item of cart) {
                            const form = getAnamneseFormForItem(item, products, anamneseForms);
                            if (form) {
                              activeForm = form;
                              break;
                            }
                          }

                          if (activeForm) {
                            setActiveAnamneseForm(activeForm);
                            setCheckoutStep('anamnese');
                            return;
                          }
                          setCheckoutStep('form');
                        }}
                        className="w-full py-4 rounded-xl font-bold text-lg shadow-xl"
                        style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                      >
                        {t.upsellSkip}
                      </button>
                      <button 
                        onClick={() => setCheckoutStep('schedule')}
                        className="w-full py-2 text-xs font-bold opacity-40 uppercase tracking-widest text-black"
                      >
                        {t.back}
                      </button>
                    </div>
                  </div>
                ) : checkoutStep === 'anamnese' ? (
                  <div className="space-y-6">
                    <div className="text-center space-y-2">
                       <h3 className="text-xl font-serif font-bold" style={{ color: '#000000' }}>{activeAnamneseForm?.title}</h3>
                       <p className="text-xs opacity-60">{currentLang === 'pt' ? 'Por favor, preencha as informações abaixo para sua segurança.' : 'Please fill in the information below for your safety.'}</p>
                    </div>

                    <div className="space-y-4">
                      {activeAnamneseForm?.questions.map((q) => (
                        <div key={q.id} className="space-y-1">
                          <label className="text-xs font-bold uppercase text-black">
                            {q.label} {q.required && '*'}
                          </label>
                          {q.type === 'text' ? (
                            <textarea 
                              required={q.required}
                              rows={2}
                              className="w-full p-3 rounded-xl border border-gray-300 outline-none text-black bg-white/50"
                              value={anamneseAnswers[q.id] || ''}
                              onChange={(e) => setAnamneseAnswers({ ...anamneseAnswers, [q.id]: e.target.value })}
                            />
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {q.options?.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => setAnamneseAnswers({ ...anamneseAnswers, [q.id]: opt })}
                                  className={cn(
                                    "px-4 py-2 rounded-full border-2 font-bold text-xs transition-all",
                                    anamneseAnswers[q.id] === opt 
                                      ? "bg-black text-white border-black" 
                                      : "bg-white/50 border-transparent text-black"
                                  )}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button 
                        onClick={() => setCheckoutStep('schedule')}
                        className="px-6 py-4 rounded-xl bg-white border border-gray-200 font-bold"
                        style={{ color: '#000000' }}
                      >
                        {t.back}
                      </button>
                      <button 
                        onClick={() => {
                          const missing = activeAnamneseForm?.questions.filter(q => q.required && !anamneseAnswers[q.id]);
                          if (missing && missing.length > 0) {
                            return;
                          }

                          if (currentSchedulingIndex < cart.length - 1) {
                            setCurrentSchedulingIndex(prev => prev + 1);
                            setCheckoutStep('schedule');
                          } else {
                            setCheckoutStep('summary');
                            setIsModalOpen(false);
                            toast.success(currentLang === 'pt' 
                              ? 'Ficha preenchida e agendamento adicionado! Você pode continuar escolhendo serviços ou finalizar clicando no carrinho.' 
                              : 'Form filled and booking added! You can continue choosing services or finalize by clicking on the cart.'
                            );
                          }
                        }}
                        disabled={activeAnamneseForm?.questions.some(q => q.required && !anamneseAnswers[q.id])}
                        className="flex-grow py-4 rounded-xl font-bold text-lg shadow-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all text-white"
                        style={{ backgroundColor: settings.primaryColor }}
                      >
                        {currentLang === 'pt' ? 'Continuar' : t.next}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="text-center space-y-1">
                      <h3 className="text-xl font-serif font-bold" style={{ color: '#000000' }}>{t.orderDetails}</h3>
                      {(() => {
                        const formatDateFriendly = (dateStr: string) => {
                          if (!dateStr) return '';
                          const parts = dateStr.split('-');
                          if (parts.length !== 3) return dateStr;
                          const monthIndex = parseInt(parts[1], 10) - 1;
                          const day = parseInt(parts[2], 10);
                          const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                          const monthsPt = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                          const mStr = currentLang === 'en' ? monthsEn[monthIndex] : monthsPt[monthIndex];
                          return `${day} ${mStr}`;
                        };

                        const formatDurationLocal = (mins: number) => {
                          const h = Math.floor(mins / 60);
                          const m = mins % 60;
                          if (h > 0) {
                              return `${h}h ${m > 0 ? `${m}min` : ''}`;
                          }
                          return `${m}min`;
                        };

                        return (
                          <div className="mt-4 space-y-3 px-1 text-left">
                            <div className="p-4 rounded-2xl bg-white/60 border border-white/40 shadow-sm space-y-3">
                              {cart.map((item, index) => {
                                const product = products.find(p => p.id === item.productId);
                                if (!product) return null;

                                const date = item.appointmentDate || formData.appointmentDate;
                                const time = item.appointmentTime || formData.appointmentTime;

                                const allowedProfs = professionals.filter(p => {
                                  if (p.isActive === false) return false;
                                  const matchesDept = !product.department || p.departments.includes(product.department);
                                  if (!matchesDept) return false;
                                  if (!product.allowedProfessionals || product.allowedProfessionals.length === 0) return true;
                                  return product.allowedProfessionals.includes(p.id);
                                }).sort((a, b) => {
                                  const d = product.department || '';
                                  const orderA = a.deptOrder?.[d] ?? a.order ?? 0;
                                  const orderB = b.deptOrder?.[d] ?? b.order ?? 0;
                                  return orderA - orderB;
                                });
                                const defaultProfId = allowedProfs[0]?.id || '';

                                const isSavedProfValid = item.professionalId && allowedProfs.some(p => p.id === item.professionalId);
                                const testSelectedProfForDept = selectedProfessionalForDept[product.department];
                                const isValidSelectedProfForDept = testSelectedProfForDept && allowedProfs.some(p => p.id === testSelectedProfForDept);
                                const profId = isSavedProfValid 
                                  ? item.professionalId 
                                  : (defaultProfId || (isValidSelectedProfForDept ? testSelectedProfForDept : ''));
                                const prof = professionals.find(p => p.id === profId);
                                const profName = prof?.name || (currentLang === 'pt' ? 'Qualquer profissional' : 'Any professional');

                                return (
                                  <div key={item.id || index} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 last:pb-0 border-b border-black/5 last:border-b-0 text-sm">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pink-50 border border-pink-100 text-pink-700 text-xs font-extrabold uppercase tracking-wider">
                                        <Calendar size={10} className="shrink-0 text-pink-600" />
                                        {formatDateFriendly(date)}
                                      </span>
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-gray-700 text-xs font-extrabold uppercase tracking-wider">
                                        <Clock size={10} className="shrink-0 text-gray-500" />
                                        {time}
                                      </span>
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pink-50/50 border border-pink-100/30 text-pink-600/90 text-xs font-bold leading-none">
                                        <User size={10} className="shrink-0 text-pink-500" />
                                        {profName}
                                      </span>
                                    </div>
                                    <div className="text-left sm:text-right flex-grow">
                                      <span className="font-bold text-xs text-black leading-tight block">
                                        {item.variation ? `${product.title} (${item.variation.name})` : product.title}
                                      </span>
                                      {item.quantity > 1 && (
                                        <span className="text-[10px] text-gray-400 font-medium block">
                                          Qty: {item.quantity}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            
                            {cart.length === 1 && (
                              <div className="flex justify-between items-center px-1 text-[10px] font-bold opacity-60 uppercase tracking-widest text-[#000000]">
                                <span>
                                  {currentLang === 'en' ? 'Total Duration' : 'Duração Total'}
                                </span>
                                <span>
                                  {formatDurationLocal(cartTotalDuration)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {settings.checkoutTitle && (
                        <p className="text-sm font-medium italic leading-relaxed px-4" style={{ color: '#000000' }}>
                          {settings.checkoutTitle}
                        </p>
                      )}
                    </div>

                    {(settings.infoBlock1Title || settings.infoBlock1Text || settings.infoBlock2Title || settings.infoBlock2Text) && (
                      <div className="grid grid-cols-1 gap-3">
                        {settings.infoBlock1Title && (
                          <div className="bg-white/50 p-4 rounded-2xl border border-white/20 shadow-sm">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#000000' }}>{settings.infoBlock1Title}</h4>
                            <p className="text-[10px] leading-relaxed" style={{ color: '#000000' }}>{settings.infoBlock1Text}</p>
                          </div>
                        )}
                        {settings.infoBlock2Title && (
                          <div className="bg-white/50 p-4 rounded-2xl border border-white/20 shadow-sm">
                            <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#000000' }}>{settings.infoBlock2Title}</h4>
                            <p className="text-[10px] leading-relaxed" style={{ color: '#000000' }}>{settings.infoBlock2Text}</p>
                          </div>
                        )}
                      </div>
                    )}

                    <form onSubmit={handleFinalizar} className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase text-black">{t.fullName} *</label>
                        <input 
                          required
                          type="text" 
                          className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 outline-none text-black"
                          style={{ '--tw-ring-color': settings.primaryColor } as any}
                          value={formData.nome}
                          onChange={e => setFormData({...formData, nome: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase text-black">PHONE NUMBER *</label>
                        <input 
                          required
                          type="tel" 
                          className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 outline-none text-black"
                          style={{ '--tw-ring-color': settings.primaryColor } as any}
                          value={formData.telefone}
                          onChange={e => {
                            let val = e.target.value.replace(/\D/g, '');
                            if (val.length > 10) val = val.slice(0, 10);
                            let formatted = val;
                            if (val.length > 6) {
                              formatted = val.replace(/^(\d{3})(\d{3})(\d{0,4})/, '($1) $2-$3');
                            } else if (val.length > 3) {
                              formatted = val.replace(/^(\d{3})(\d{0,3})/, '($1) $2');
                            } else if (val.length > 0) {
                              formatted = `(${val}`;
                            }
                            setFormData({...formData, telefone: formatted});
                          }}
                          placeholder="(999) 999-9999"
                        />
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold uppercase text-black">
                            {t.birthday} *
                          </label>
                          <input 
                            required
                            type="text" 
                            placeholder={t.birthdayPlaceholder}
                            className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 outline-none text-black"
                            style={{ '--tw-ring-color': settings.primaryColor } as any}
                            value={formData.aniversario}
                            onChange={e => {
                              let val = e.target.value.replace(/\D/g, '');
                              if (val.length > 4) val = val.slice(0, 4);
                              if (val.length > 2) val = val.slice(0, 2) + '/' + val.slice(2);
                              setFormData({...formData, aniversario: val});
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold uppercase text-black">{t.email} *</label>
                          <input 
                            required
                            type="email" 
                            className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 outline-none text-black"
                            style={{ '--tw-ring-color': settings.primaryColor } as any}
                            value={formData.email}
                            onChange={e => setFormData({...formData, email: e.target.value})}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase text-black">{t.observation}</label>
                        <textarea 
                          rows={2}
                          className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 outline-none text-black"
                          style={{ '--tw-ring-color': settings.primaryColor } as any}
                          value={formData.observacao}
                          onChange={e => setFormData({...formData, observacao: e.target.value})}
                        />
                      </div>

                      <div className="flex gap-3 pt-4">
                        <button 
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setCheckoutStep('summary')}
                          className="px-6 py-4 rounded-xl bg-white border border-gray-200 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{ color: '#000000' }}
                        >
                          {t.back}
                        </button>
                        <button 
                          type="submit"
                          disabled={isSubmitting}
                          className={cn(
                            "flex-grow py-4 rounded-xl text-white font-bold text-lg shadow-xl transition-all flex items-center justify-center gap-2",
                            isSubmitting ? "opacity-70 cursor-not-allowed scale-100" : "active:scale-95"
                          )}
                          style={{ backgroundColor: settings.primaryColor }}
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className="animate-spin" size={20} />
                              {currentLang === 'pt' ? 'PROCESSANDO...' : 'PROCESSING...'}
                            </>
                          ) : (
                            t.finish
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </div>
    )}
  </AnimatePresence>

      <AnimatePresence>
        {isCustomModalOpen && selectedProductForCustom && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCustomModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-[#ece6db] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-white/30">
                <h2 className="text-2xl font-serif font-bold" style={{ color: '#000000' }}>{t.customCakeTitle}</h2>
                <button 
                  onClick={() => setIsCustomModalOpen(false)} 
                  className="p-2 hover:bg-white/50 rounded-full transition-colors"
                  style={{ color: '#000000' }}
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto space-y-8 custom-scrollbar">
                {selectedProductForCustom.variations && selectedProductForCustom.variations.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#000000' }}>{currentLang === 'en' ? 'Choose Type / Length' : 'Choose Type / Length'}</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {selectedProductForCustom.variations.map((v, i) => (
                        <button 
                          key={i}
                          onClick={() => setVariationSelection(v)}
                          className={cn(
                            "flex items-center justify-between p-4 rounded-2xl border-2 transition-all",
                            variationSelection?.name === v.name 
                            ? "bg-black text-white border-black shadow-lg" 
                            : "bg-white/40 border-white/20 hover:border-black/20"
                          )}
                        >
                          <div className="text-left font-bold">
                            <div className="text-sm">{v.name}</div>
                            {v.duration > 0 && <div className="text-[10px] opacity-60">+{v.duration} min</div>}
                          </div>
                          <div className="text-sm font-bold">
                            {v.price > 0 ? `+ ${currencySymbol} ${v.price.toFixed(2)}` : (currentLang === 'en' ? 'Included' : 'Included')}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedProductForCustom.ingredients && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#000000' }}>{t.excludeIngredients}</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedProductForCustom.ingredients.split(',').map((ingredient, idx) => {
                        const name = ingredient.trim();
                        const isSelected = mealSelections.removals.includes(name);
                        return (
                          <button 
                            key={idx}
                            onClick={() => {
                              if (isSelected) {
                                setMealSelections({
                                  ...mealSelections,
                                  removals: mealSelections.removals.filter(r => r !== name)
                                });
                              } else {
                                setMealSelections({
                                  ...mealSelections,
                                  removals: [...mealSelections.removals, name]
                                });
                              }
                            }}
                            className={cn(
                              "px-4 py-2 rounded-full border-2 font-bold transition-all text-sm",
                              isSelected 
                                ? "bg-red-500 border-red-500 text-white shadow-md" 
                                : "bg-white/50 border-transparent text-black"
                            )}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedProductForCustom.allowedSides && selectedProductForCustom.allowedSides.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#000000' }}>{t.chooseSides}</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {selectedProductForCustom.allowedSides.map(sideId => {
                        const side = sides.find(s => s.id === sideId);
                        if (!side) return null;
                        const isSelected = mealSelections.sides.some(s => s.id === side.id);
                        return (
                          <button 
                            key={side.id}
                            onClick={() => {
                              if (isSelected) {
                                setMealSelections({
                                  ...mealSelections,
                                  sides: mealSelections.sides.filter(s => s.id !== side.id)
                                });
                              } else {
                                setMealSelections({
                                  ...mealSelections,
                                  sides: [...mealSelections.sides, side]
                                });
                              }
                            }}
                            className={cn(
                              "p-4 rounded-xl border-2 font-bold transition-all flex justify-between items-center",
                              isSelected 
                                ? "bg-white border-blue-500 text-blue-600 shadow-md" 
                                : "bg-white/50 border-transparent text-black"
                            )}
                          >
                            <span>{side.name}</span>
                            <span className="text-xs opacity-60">
                              {side.price > 0 ? `+ ${currencySymbol} ${side.price.toFixed(2)}` : (currentLang === 'en' ? 'Free' : 'Free')}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 bg-white/30 border-t border-gray-200">
                <button 
                  onClick={addMealToCart}
                  disabled={selectedProductForCustom.variations && selectedProductForCustom.variations.length > 0 && !variationSelection}
                  className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-xl transition-transform active:scale-95 disabled:opacity-30 disabled:scale-100"
                  style={{ backgroundColor: settings.primaryColor }}
                >
                  {t.addToCart}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedProductForDetails && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] shadow-2xl"
            >
              <div className="relative h-64 flex-shrink-0">
                <img src={selectedProductForDetails.image} className="w-full h-full object-cover" />
                <button 
                  onClick={() => setSelectedProductForDetails(null)}
                  className="absolute top-4 right-4 p-2 bg-black/40 text-white rounded-full backdrop-blur-md hover:bg-black/60 transition-all"
                >
                  <X size={24} />
                </button>
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent text-white">
                  <h2 className="text-3xl font-serif font-bold leading-tight">{selectedProductForDetails.title}</h2>
                  {selectedProductForDetails.duration && (
                    <div className="flex items-center gap-1.5 text-xs font-bold opacity-80 uppercase tracking-wider mt-1">
                      <Clock size={12} /> {formatDuration(selectedProductForDetails.duration)}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar flex-grow">
                <div className="space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: settings.primaryColor }}>{currentLang === 'en' ? 'About this procedure' : 'About this procedure'}</h3>
                  <p className="text-lg leading-relaxed whitespace-pre-wrap italic font-serif" style={{ color: settings.primaryColor }}>
                    {selectedProductForDetails.description || (currentLang === 'en' ? 'No detailed description available.' : 'No detailed description available.')}
                  </p>
                </div>

                <div className="pt-6 flex flex-col items-center gap-4" style={{ borderTop: `1px solid ${settings.primaryColor}20` }}>
                  <div className="text-center">
                    <span className="text-[10px] font-bold uppercase tracking-widest block mb-1" style={{ color: settings.primaryColor }}>{currentLang === 'en' ? 'Starting at' : 'Starting at'}</span>
                    <span className="text-4xl font-bold" style={{ color: settings.primaryColor }}>
                      {currencySymbol} {(Number(selectedProductForDetails.price) > 0 ? Number(selectedProductForDetails.price) : (Number(selectedProductForDetails.oldPrice) || 0)).toFixed(2)}
                    </span>
                  </div>

                  <button 
                    onClick={() => {
                      addToCart(selectedProductForDetails);
                      setSelectedProductForDetails(null);
                    }}
                    className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-xl"
                    style={{ backgroundColor: settings.primaryColor }}
                  >
                    {currentLang === 'en' ? 'SCHEDULE THIS SERVICE' : 'SCHEDULE THIS SERVICE'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isWaitlistModalOpen && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl relative my-8"
            >
              <button 
                type="button"
                onClick={() => setIsWaitlistModalOpen(false)}
                className="absolute top-6 right-6 p-2 bg-black/5 hover:bg-black/10 text-black/60 rounded-full transition-all"
              >
                <X size={18} />
              </button>

              <div className="space-y-6 text-black text-left">
                <div className="space-y-1">
                  <h3 className="text-2xl font-serif font-bold tracking-tight" style={{ color: '#111827' }}>Join the Waitlist</h3>
                  <p className="text-xs opacity-60">We'll let you know as soon as an opening is available!</p>
                </div>

                <form 
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!waitlistForm.name || !waitlistForm.phone || !waitlistForm.department || !waitlistForm.preferredDate) {
                      toast.error('Please fill in all required fields.');
                      return;
                    }
                    setIsSavingWaitlist(true);
                    try {
                      await addDoc(collection(db, 'waitlist'), {
                        name: waitlistForm.name,
                        phone: waitlistForm.phone,
                        department: waitlistForm.department,
                        service: waitlistForm.service || '',
                        preferredDate: waitlistForm.preferredDate,
                        preferredPeriod: waitlistForm.preferredPeriod,
                        notes: waitlistForm.notes || '',
                        createdAt: serverTimestamp()
                      });
                      toast.success('Successfully added to the waitlist!');
                      setIsWaitlistModalOpen(false);
                      setWaitlistForm({
                        name: '',
                        phone: '',
                        department: '',
                        service: '',
                        preferredDate: '',
                        preferredPeriod: 'Anytime',
                        notes: ''
                      });
                    } catch (error) {
                      console.error('Error saving waitlist item: ', error);
                      toast.error('An error occurred. Please try again.');
                    } finally {
                      setIsSavingWaitlist(false);
                    }
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Full Name *</label>
                    <input 
                      required
                      type="text"
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black"
                      value={waitlistForm.name}
                      onChange={e => setWaitlistForm({...waitlistForm, name: e.target.value})}
                      placeholder="e.g., Janet Doe"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Phone Number *</label>
                    <input 
                      required
                      type="tel"
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black"
                      value={waitlistForm.phone}
                      onChange={e => {
                        let val = e.target.value.replace(/\D/g, '');
                        if (val.length > 10) val = val.slice(0, 10);
                        let formatted = val;
                        if (val.length > 6) {
                          formatted = val.replace(/^(\d{3})(\d{3})(\d{0,4})/, '($1) $2-$3');
                        } else if (val.length > 3) {
                          formatted = val.replace(/^(\d{3})(\d{0,3})/, '($1) $2');
                        } else if (val.length > 0) {
                          formatted = `(${val}`;
                        }
                        setWaitlistForm({...waitlistForm, phone: formatted});
                      }}
                      placeholder="(999) 999-9999"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Desired Area *</label>
                    <select
                      required
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                      value={waitlistForm.department}
                      onChange={e => setWaitlistForm({...waitlistForm, department: e.target.value, service: ''})}
                    >
                      <option value="">Select an option...</option>
                      {(() => {
                        const list = [];
                        if (settings.showHair !== false) list.push({ value: 'hair', label: 'Hair' });
                        if (settings.showMakeup !== false) list.push({ value: 'makeup', label: 'Makeup' });
                        if (settings.showNails !== false) list.push({ value: 'nails', label: 'Nails' });
                        if (settings.showSpa !== false) list.push({ value: 'spa', label: 'Spa' });
                        if (settings.showClinic !== false) list.push({ value: 'clinic', label: 'Clinic' });
                        if (settings.showAesthetic !== false) list.push({ value: 'aesthetic', label: 'Aesthetic' });
                        return list.map(dept => (
                          <option key={dept.value} value={dept.value}>{dept.label}</option>
                        ));
                      })()}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Desired Service</label>
                    <select
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                      value={waitlistForm.service}
                      onChange={e => setWaitlistForm({...waitlistForm, service: e.target.value})}
                    >
                      <option value="">Select a service (optional)...</option>
                      {products
                        .filter(p => !waitlistForm.department || p.department === waitlistForm.department)
                        .map(p => (
                          <option key={p.id} value={p.title}>{p.title}</option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Preferred Date *</label>
                    <input 
                      required
                      type="date"
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                      value={waitlistForm.preferredDate}
                      onChange={e => setWaitlistForm({...waitlistForm, preferredDate: e.target.value})}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Preferred Period</label>
                    <select
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                      value={waitlistForm.preferredPeriod}
                      onChange={e => setWaitlistForm({...waitlistForm, preferredPeriod: e.target.value})}
                    >
                      <option value="Morning">Morning</option>
                      <option value="Afternoon">Afternoon</option>
                      <option value="Night">Night</option>
                      <option value="Anytime">Anytime</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Notes</label>
                    <textarea 
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black min-h-[80px]"
                      value={waitlistForm.notes}
                      onChange={e => setWaitlistForm({...waitlistForm, notes: e.target.value})}
                      placeholder="e.g., Any additional details..."
                    />
                  </div>

                  <button
                    disabled={isSavingWaitlist}
                    className="w-full py-4 rounded-xl text-white font-bold uppercase text-xs tracking-wider transition-all shadow-md mt-2 flex items-center justify-center gap-2"
                    style={{ backgroundColor: settings.primaryColor }}
                  >
                    {isSavingWaitlist ? <Loader2 className="animate-spin" size={16} /> : 'Send Request'}
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}

        {isCancelModalOpen && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl relative my-8"
            >
              <button 
                type="button"
                onClick={() => {
                  setIsCancelModalOpen(false);
                  setCancelRequestFinalized(null);
                  setCancelForm({
                    name: '',
                    phone: '',
                    date: '',
                    time: '',
                    professionalId: '',
                    professionalName: '',
                    requestType: 'cancel',
                    notes: ''
                  });
                }}
                className="absolute top-6 right-6 p-2 bg-black/5 hover:bg-black/10 text-black/60 rounded-full transition-all"
              >
                <X size={18} />
              </button>

              <div className="space-y-6 text-black text-left">
                {!cancelRequestFinalized ? (
                  <>
                    <div className="space-y-1">
                      <h3 className="text-2xl font-serif font-bold tracking-tight" style={{ color: '#111827' }}>Cancellation / Reschedule Request</h3>
                      <p className="text-xs opacity-60">Please fill in your appointment details. This is a request only and must be confirmed by our team.</p>
                    </div>

                    <form onSubmit={handleCancelSubmit} className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Full Name *</label>
                        <input 
                          required
                          type="text"
                          className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                          value={cancelForm.name}
                          onChange={e => setCancelForm({...cancelForm, name: e.target.value})}
                          placeholder="e.g., Jane Doe"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Phone Number *</label>
                        <input 
                          required
                          type="tel"
                          className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                          value={cancelForm.phone}
                          onChange={e => {
                            let val = e.target.value.replace(/\D/g, '');
                            if (val.length > 10) val = val.slice(0, 10);
                            let formatted = val;
                            if (val.length > 6) {
                              formatted = val.replace(/^(\d{3})(\d{3})(\d{0,4})/, '($1) $2-$3');
                            } else if (val.length > 3) {
                              formatted = val.replace(/^(\d{3})(\d{0,3})/, '($1) $2');
                            } else if (val.length > 0) {
                              formatted = `(${val}`;
                            }
                            setCancelForm({...cancelForm, phone: formatted});
                          }}
                          placeholder="(999) 999-9999"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Appt Date *</label>
                          <input 
                            required
                            type="date"
                            className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                            value={cancelForm.date}
                            onChange={e => setCancelForm({...cancelForm, date: e.target.value})}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Appt Time *</label>
                          <input 
                            required
                            type="text"
                            placeholder="e.g., 10:00 AM"
                            className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                            value={cancelForm.time}
                            onChange={e => {
                              let val = e.target.value.toUpperCase();
                              // Allow only numbers, space, colon, and A/P/M
                              let clean = val.replace(/[^0-9: APM]/g, '');
                              
                              // Format numbers to HH:MM AM/PM
                              let digits = clean.replace(/\D/g, '');
                              if (digits.length > 4) digits = digits.slice(0, 4);
                              
                              let timePart = '';
                              if (digits.length > 2) {
                                timePart = `${digits.slice(0, 2)}:${digits.slice(2)}`;
                              } else if (digits.length > 0) {
                                timePart = digits;
                              }
                              
                              let period = '';
                              if (clean.includes('P')) {
                                period = ' PM';
                              } else if (clean.includes('A')) {
                                period = ' AM';
                              } else if (digits.length === 4) {
                                period = ' AM';
                              }
                              
                              setCancelForm({...cancelForm, time: timePart + period});
                            }}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Professional *</label>
                        <select
                          required
                          className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black bg-white"
                          value={cancelForm.professionalId}
                          onChange={e => {
                            const pId = e.target.value;
                            const pName = professionals.find(p => p.id === pId)?.name || '';
                            setCancelForm({...cancelForm, professionalId: pId, professionalName: pName});
                          }}
                        >
                          <option value="">Select Professional...</option>
                          {professionals.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Request Type *</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setCancelForm({...cancelForm, requestType: 'cancel'})}
                            className={cn(
                              "py-3 rounded-xl font-bold text-xs uppercase tracking-wider border transition-all",
                              cancelForm.requestType === 'cancel'
                                ? "bg-black text-white border-black"
                                : "bg-white text-black border-gray-200 hover:bg-black/5"
                            )}
                          >
                            Cancel Appointment
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelForm({...cancelForm, requestType: 'reschedule'})}
                            className={cn(
                              "py-3 rounded-xl font-bold text-xs uppercase tracking-wider border transition-all",
                              cancelForm.requestType === 'reschedule'
                                ? "bg-black text-white border-black"
                                : "bg-white text-black border-gray-200 hover:bg-black/5"
                            )}
                          >
                            Reschedule
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-wider opacity-60 block">Notes / Reason</label>
                        <textarea 
                          className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-black/10 transition-all font-medium text-sm text-black min-h-[80px] bg-white"
                          value={cancelForm.notes}
                          onChange={e => setCancelForm({...cancelForm, notes: e.target.value})}
                          placeholder="e.g., I need to reschedule due to an emergency..."
                        />
                      </div>

                      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                        <strong>Please note:</strong> This is a request only. Your appointment remains active until our team contacts you to confirm the cancellation or reschedule.
                      </div>

                      <button
                        disabled={isSavingCancelRequest}
                        className="w-full py-4 rounded-xl text-white font-bold uppercase text-xs tracking-wider transition-all shadow-md mt-2 flex items-center justify-center gap-2"
                        style={{ backgroundColor: settings.primaryColor }}
                      >
                        {isSavingCancelRequest ? <Loader2 className="animate-spin" size={16} /> : 'Submit Request'}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="text-center space-y-6 py-4">
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-serif font-bold tracking-tight" style={{ color: '#111827' }}>Request Recorded!</h3>
                      <p className="text-xs opacity-70 leading-relaxed">
                        Your request has been saved in our system. To speed up your cancellation or rescheduling, we highly recommend notifying our team directly via WhatsApp or SMS.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 pt-2">
                      <a 
                        href={cancelRequestFinalized.whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-2 bg-[#25D366] text-white py-3.5 rounded-xl font-bold hover:scale-[1.01] transition-all shadow-md text-xs uppercase tracking-wider"
                      >
                        <MessageCircle size={16} fill="currentColor" /> Send WhatsApp
                      </a>
                      <a 
                        href={cancelRequestFinalized.smsUrl}
                        className="flex items-center justify-center gap-2 bg-[#007AFF] text-white py-3.5 rounded-xl font-bold hover:scale-[1.01] transition-all shadow-md text-xs uppercase tracking-wider"
                      >
                        <MessageSquare size={16} /> Send via SMS
                      </a>
                    </div>

                    <button 
                      onClick={() => {
                        setIsCancelModalOpen(false);
                        setCancelRequestFinalized(null);
                        setCancelForm({
                          name: '',
                          phone: '',
                          date: '',
                          time: '',
                          professionalId: '',
                          professionalName: '',
                          requestType: 'cancel',
                          notes: ''
                        });
                      }}
                      className="text-black/50 text-[10px] font-bold uppercase tracking-widest hover:text-black transition-colors pt-4 block w-full"
                    >
                      Close & Finish
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

      </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
