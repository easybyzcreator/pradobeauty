import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { 
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc, deleteField,
  query, orderBy, serverTimestamp, getDocs 
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { Product, Order, Settings, Category, Side, CustomerRecord, Holiday, AnamneseForm, AnamneseQuestion, Professional, BlacklistRecord, WorkingHours, DaySchedule } from '../types';
import { 
  Settings as SettingsIcon, Package, History, LogOut, Plus, Trash2, Edit2, 
  Save, X, Copy, CheckCircle2, Loader2, Layers, Image as ImageIcon,
  ArrowUp, ArrowDown, ClipboardList, MessageCircle, MessageSquare, Calendar, Printer, Cake, Eye, EyeOff, Clock, CalendarOff, CalendarX,
  DollarSign, Coins, ChevronDown, ChevronUp, Users, User, FlaskConical,
  Scissors, Palette, Sparkles, MapPin, Globe, Sparkles as SparklesAI,
  ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Lock, TrendingUp, Search, UserPlus, UserX, RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { DEFAULT_LOGO } from '../constants';
import QRCode from 'qrcode';

const normalizeTo24h = (time: string): string => {
  if (!time) return '';
  const clean = time.trim();
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();
    if (period === 'PM' && h < 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${h.toString().padStart(2, '0')}:${m}`;
  }
  const standardMatch = clean.match(/^(\d{1,2}):(\d{2})/);
  if (standardMatch) {
    const h = parseInt(standardMatch[1], 10);
    const m = standardMatch[2];
    return `${h.toString().padStart(2, '0')}:${m}`;
  }
  return clean;
};

const formatToMMDDYYYY = (dateStr: string) => {
  if (!dateStr) return '';
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[2]}/${match[3]}/${match[1]}`;
  }
  return dateStr;
};

interface CalendarPositionedItem {
  order: Order;
  item: any;
  orderId: string;
  itemIndex: number;
  startMinutes: number;
  endMinutes: number;
  duration: number;
  timeStr: string;
  colIndex: number;
  totalCols: number;
}

const getProfessionalDayLayout = (
  ordersList: Order[],
  profId: string,
  isoDateStr: string,
  dateStr: string,
  searchQuery?: string
): CalendarPositionedItem[] => {
  const items: CalendarPositionedItem[] = [];

  ordersList.forEach((order) => {
    if (order.status === 'cancelled' || order.status === 'no-show') return;
    if (searchQuery && !order.customerName.toLowerCase().includes(searchQuery.toLowerCase())) {
      return;
    }

    (order.items || []).forEach((it, idx) => {
      const itemDate = it.appointmentDate || order.appointmentDate || '';
      const matchesDate = itemDate === isoDateStr || itemDate === dateStr;
      if (!matchesDate) return;

      const matchesProf = it.professionalId ? it.professionalId === profId : (order as any).professionalId === profId;
      if (!matchesProf) return;

      const timeRaw = it.appointmentTime || order.appointmentTime || '';
      if (!timeRaw) return;
      const normalizedTime = normalizeTo24h(timeRaw);
      const [h, m] = normalizedTime.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return;

      const startMinutes = h * 60 + m;
      const duration = Math.max(15, it.duration || 60);
      const endMinutes = startMinutes + duration;

      items.push({
        order,
        item: it,
        orderId: order.id,
        itemIndex: idx,
        startMinutes,
        endMinutes,
        duration,
        timeStr: normalizedTime,
        colIndex: 0,
        totalCols: 1
      });
    });
  });

  // Sort by start time ascending, then longer duration first
  items.sort((a, b) => a.startMinutes - b.startMinutes || b.duration - a.duration);

  // Assign columns greedily using interval graph coloring
  const colEndTimes: number[] = [];
  items.forEach((item) => {
    let assignedCol = -1;
    for (let c = 0; c < colEndTimes.length; c++) {
      if (colEndTimes[c] <= item.startMinutes) {
        assignedCol = c;
        colEndTimes[c] = item.endMinutes;
        break;
      }
    }
    if (assignedCol === -1) {
      assignedCol = colEndTimes.length;
      colEndTimes.push(item.endMinutes);
    }
    item.colIndex = assignedCol;
  });

  // Group overlapping items into connected clusters to calculate totalCols
  const clusters: CalendarPositionedItem[][] = [];
  items.forEach((item) => {
    const overlappingClusters = clusters.filter(cl =>
      cl.some(c => item.startMinutes < c.endMinutes && c.startMinutes < item.endMinutes)
    );

    if (overlappingClusters.length === 0) {
      clusters.push([item]);
    } else {
      const newCluster = [item];
      overlappingClusters.forEach(cl => {
        newCluster.push(...cl);
        const idx = clusters.indexOf(cl);
        if (idx !== -1) clusters.splice(idx, 1);
      });
      clusters.push(newCluster);
    }
  });

  // Set totalCols for each cluster
  clusters.forEach((cluster) => {
    const maxCol = Math.max(...cluster.map(i => i.colIndex)) + 1;
    cluster.forEach(i => {
      i.totalCols = maxCol;
    });
  });

  return items;
};

export default function Admin({ settings, setSettings, setIsAdmin }: { 
  settings: Settings, 
  setSettings: React.Dispatch<React.SetStateAction<Settings>>,
  setIsAdmin: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState('');
  const [deptLoggedIn, setDeptLoggedIn] = useState({ 
    hair: false, makeup: false, nails: false, spa: false, clinic: false, aesthetic: false 
  });
  const [isSeeding, setIsSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'orders' | 'categories' | 'sides' | 'customers' | 'holidays' | 'seo' | 'working-hours' | 'catalog' | 'anamnese' | 'professionals' | 'blacklist' | 'finance' | 'waitlist' | 'cancellation'>('orders');
  const [financeDateRange, setFinanceDateRange] = useState({ 
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0] 
  });
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedFinanceProf, setSelectedFinanceProf] = useState<string | null>(null);
  const [selectedBlockDetail, setSelectedBlockDetail] = useState<{
    title: string;
    notes: string;
    startTime: string;
    endTime: string;
    profName?: string;
    originalBlock?: any;
  } | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [cancellationRequests, setCancellationRequests] = useState<any[]>([]);
  const [isEditingProfessional, setIsEditingProfessional] = useState<Professional | null>(null);
  const [profDeptFilter, setProfDeptFilter] = useState<'all' | 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic'>('all');
  const [newProfessional, setNewProfessional] = useState<Omit<Professional, 'id'>>({
    name: '',
    departments: [],
    order: 0,
    deptOrder: {},
    isActive: true,
    avatar: '',
    zelleQR: ''
  });
  const [isEditingBlacklist, setIsEditingBlacklist] = useState<BlacklistRecord | null>(null);
  const [newBlacklist, setNewBlacklist] = useState<Omit<BlacklistRecord, 'id' | 'createdAt'>>({
    phone: '',
    email: '',
    reason: ''
  });
  const [orderProfessionalFilter, setOrderProfessionalFilter] = useState<string>('all');
  const [orderFinalizedAction, setOrderFinalizedAction] = useState<{message: string, whatsappUrl: string, smsUrl: string, customerName: string} | null>(null);
  const [isManualBooking, setIsManualBooking] = useState(false);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string>('');
  const [workingHoursProfessionalId, setWorkingHoursProfessionalId] = useState<string>('studio');
  const [editingProfHoursId, setEditingProfHoursId] = useState<string | null>(null);
  const [isEditingStudio, setIsEditingStudio] = useState(false);
  const [isOpeningSlot, setIsOpeningSlot] = useState(false);
  const [openingSlotProfId, setOpeningSlotProfId] = useState<string | null>(null);
  const [newExtraSlot, setNewExtraSlot] = useState({
    date: new Date().toISOString().split('T')[0],
    start: '',
    end: ''
  });

  const [manualBookingStep, setManualBookingStep] = useState<'client' | 'services' | 'schedule'>('client');
  const [manualBookingData, setManualBookingData] = useState<Partial<Order>>({
    customerName: '',
    phone: '',
    items: [],
    total: 0,
    notes: '',
    discount: 0,
    appointmentDate: new Date().toISOString().split('T')[0],
    appointmentTime: '',
    status: 'pending'
  });
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [manualBookingServiceSearch, setManualBookingServiceSearch] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [manualBookingAnamneseAnswers, setManualBookingAnamneseAnswers] = useState<Record<string, any>>({});
  const [activeManualAnamneseForm, setActiveManualAnamneseForm] = useState<AnamneseForm | null>(null);

  const [isBlockingModalOpen, setIsBlockingModalOpen] = useState(false);
  const [blockingProfId, setBlockingProfId] = useState('all');
  const [blockingDate, setBlockingDate] = useState('');
  const [blockingStartTime, setBlockingStartTime] = useState('');
  const [blockingEndTime, setBlockingEndTime] = useState('');
  const [blockingNotes, setBlockingNotes] = useState('');

  const addMinutesToTime = (timeStr: string, minutes: number): string => {
    if (!timeStr) return '';
    let [timePart, period] = timeStr.trim().split(' ');
    let [h, m] = timePart.split(':').map(Number);
    
    if (period) {
      if (period.toUpperCase() === 'PM' && h < 12) h += 12;
      if (period.toUpperCase() === 'AM' && h === 12) h = 0;
    }
    
    const totalMinutes = h * 60 + m + minutes;
    const finalH = Math.floor(totalMinutes / 60) % 24;
    const finalM = totalMinutes % 60;
    
    if (period) {
      const ampm = finalH >= 12 ? 'PM' : 'AM';
      const displayH = finalH % 12 === 0 ? 12 : finalH % 12;
      return `${displayH.toString().padStart(2, '0')}:${finalM.toString().padStart(2, '0')} ${ampm}`;
    } else {
      return `${finalH.toString().padStart(2, '0')}:${finalM.toString().padStart(2, '0')}`;
    }
  };

  const handleManualBookingSubmit = async () => {
    try {
      if (!manualBookingData.customerName || !manualBookingData.phone || !manualBookingData.appointmentDate || !manualBookingData.appointmentTime || !manualBookingData.items?.length) {
        toast.error('Please fill all required fields');
        return;
      }

      // Remove ID and other internal fields from data to be saved
      const { id, createdAt, updatedAt, ...restData } = manualBookingData as any;

      const itemsTotal = manualBookingData.items?.reduce((acc, i) => acc + (i.price * i.quantity), 0) || 0;
      const discountVal = parseFloat(manualBookingData.discount as any) || 0;
      const finalTotal = Math.max(0, itemsTotal - discountVal);

      let currentTime = manualBookingData.appointmentTime;
      const consecutiveItems = (manualBookingData.items || []).map((item) => {
        const itemTime = currentTime;
        currentTime = addMinutesToTime(currentTime, (item.duration || 0) * (item.quantity || 1));
        return {
          ...item,
          appointmentTime: itemTime,
          appointmentDate: item.appointmentDate || manualBookingData.appointmentDate
        };
      });

      const orderData = {
        ...restData,
        items: consecutiveItems,
        customerName: restData.customerName?.trim() || '',
        phone: restData.phone?.trim() || '',
        anamneseAnswers: Object.keys(manualBookingAnamneseAnswers).length > 0 ? manualBookingAnamneseAnswers : (restData.anamneseAnswers || {}),
        updatedAt: serverTimestamp(),
        discount: discountVal,
        total: finalTotal
      };

      if (isEditingOrder) {
        await updateDoc(doc(db, 'pedidos', isEditingOrder.id), orderData);
        toast.success('Appointment updated successfully!');
      } else {
        await addDoc(collection(db, 'pedidos'), {
          ...orderData,
          createdAt: serverTimestamp()
        });
        toast.success('Manual appointment created successfully!');

        // Message generation for choice modal
        const formattedApptDate = formatToMMDDYYYY(orderData.appointmentDate);
        const formattedApptTime = formatTimeToAMPM(orderData.appointmentTime);
        const message = `${settings.brandName || 'Studio'}: Hello ${orderData.customerName}! Your appointment is confirmed for ${formattedApptDate} at ${formattedApptTime}. ${settings.whatsappClosingMessage || ''}`;
        const encodedMessage = encodeURIComponent(message);
        const countryCodeRaw = settings.whatsappCountryCode?.replace(/\D/g, '') || '1';
        let cleanPhone = orderData.phone.replace(/\D/g, '');
        if (cleanPhone.startsWith(countryCodeRaw)) {
          cleanPhone = cleanPhone.slice(countryCodeRaw.length);
        }
        const whatsappUrl = `https://wa.me/${countryCodeRaw}${cleanPhone}?text=${encodedMessage}`;
        const smsUrl = `sms:${countryCodeRaw}${cleanPhone}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodedMessage}`;
        
        setOrderFinalizedAction({
          message,
          whatsappUrl,
          smsUrl,
          customerName: orderData.customerName
        });
      }

      setIsManualBooking(false);
      setIsEditingOrder(null);
      setManualBookingStep('client');
      setManualBookingAnamneseAnswers({});
      setActiveManualAnamneseForm(null);
      setManualBookingData({
        customerName: '',
        phone: '',
        email: '',
        instagram: '',
        items: [],
        total: 0,
        notes: '',
        discount: 0,
        appointmentDate: new Date().toISOString().split('T')[0],
        appointmentTime: '',
        status: 'pending'
      } as any);
    } catch (err) {
      console.error(err);
      toast.error('Error saving appointment');
    }
  };

  const handleUpdateWorkingHours = async (day: keyof WorkingHours, schedule: any) => {
    try {
      if (workingHoursProfessionalId === 'studio') {
        const studioHours = { ...(settings.hairWorkingHours || {}) };
        (studioHours as any)[day] = schedule;
        setSettings({ 
          ...settings, 
          hairWorkingHours: studioHours as any,
          makeupWorkingHours: studioHours as any,
          nailsWorkingHours: studioHours as any,
          spaWorkingHours: studioHours as any,
          clinicWorkingHours: studioHours as any,
          aestheticWorkingHours: studioHours as any,
          workingHours: studioHours as any
        });
      } else {
        const prof = professionals.find(p => p.id === workingHoursProfessionalId);
        if (prof) {
          const profHours = { ...(prof.workingHours || {}) };
          (profHours as any)[day] = schedule;
          await updateDoc(doc(db, 'profissionais', prof.id), { workingHours: profHours });
          toast.success(`Schedule for ${prof.name} updated!`);
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Error updating schedule');
    }
  };

  const getDaySchedule = (day: keyof WorkingHours) => {
    if (workingHoursProfessionalId === 'studio') {
      return settings.hairWorkingHours?.[day] || { isOpen: true, start: '09:00', end: '18:00' };
    } else {
      const prof = professionals.find(p => p.id === workingHoursProfessionalId);
      return prof?.workingHours?.[day] || settings.hairWorkingHours?.[day] || { isOpen: true, start: '09:00', end: '18:00' };
    }
  };

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

  const handleAddProfessional = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!newProfessional.name) return;
      if (isEditingProfessional) {
        // Ensure all currently selected departments have an order if they don't yet
        const currentDeptOrder = newProfessional.deptOrder || {};
        newProfessional.departments.forEach(d => {
          if (currentDeptOrder[d] === undefined) {
             const deptProfs = professionals.filter(p => p.departments.includes(d) && p.id !== isEditingProfessional.id);
             const maxOrder = deptProfs.length > 0 ? Math.max(...deptProfs.map(p => p.deptOrder?.[d] ?? p.order ?? 0)) : -1;
             currentDeptOrder[d] = maxOrder + 1;
          }
        });
        await updateDoc(doc(db, 'profissionais', isEditingProfessional.id), { ...newProfessional, deptOrder: currentDeptOrder });
        toast.success('Professional updated!');
      } else {
        const nextOrder = professionals.length > 0 ? professionals[professionals.length - 1].order + 1 : 0;
        
        // Initial dept orders
        const deptOrder: Record<string, number> = {};
        newProfessional.departments.forEach(d => {
          const deptProfs = professionals.filter(p => p.departments.includes(d));
          const maxOrder = deptProfs.length > 0 ? Math.max(...deptProfs.map(p => p.deptOrder?.[d] ?? p.order ?? 0)) : -1;
          deptOrder[d] = maxOrder + 1;
        });

        await addDoc(collection(db, 'profissionais'), { 
          ...newProfessional, 
          order: nextOrder, 
          deptOrder,
          createdAt: serverTimestamp() 
        });
        toast.success('Professional added!');
      }
      setIsEditingProfessional(null);
      setNewProfessional({ name: '', departments: [], order: 0, deptOrder: {}, isActive: true, avatar: '', zelleQR: '' });
    } catch (err) {
      toast.error('Error saving professional');
    }
  };

  const handleAddBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!newBlacklist.phone) return;
      if (isEditingBlacklist) {
        await updateDoc(doc(db, 'blacklist', isEditingBlacklist.id), newBlacklist);
      } else {
        await addDoc(collection(db, 'blacklist'), { ...newBlacklist, createdAt: serverTimestamp() });
      }
      setIsEditingBlacklist(null);
      setNewBlacklist({ phone: '', email: '', reason: '' });
      toast.success('Blacklist updated!');
    } catch (err) {
      toast.error('Error saving');
    }
  };
  const [newAnamneseForm, setNewAnamneseForm] = useState<Partial<AnamneseForm>>({ title: '', questions: [] });
  const [anamneseForms, setAnamneseForms] = useState<AnamneseForm[]>([]);
  const [isEditingAnamnese, setIsEditingAnamnese] = useState<AnamneseForm | null>(null);
  const [sides, setSides] = useState<Side[]>([]);
  const [newSide, setNewSide] = useState<Partial<Side>>({ name: '', price: 0 });
  const [isEditingSide, setIsEditingSide] = useState<Side | null>(null);
  const [sidePriceInput, setSidePriceInput] = useState('');
  
  const [customerRecords, setCustomerRecords] = useState<CustomerRecord[]>([]);
  const [horariosExtras, setHorariosExtras] = useState<any[]>([]);

  useEffect(() => {
    const unsubExtras = onSnapshot(collection(db, 'horarios_extras'), (snapshot) => {
      setHorariosExtras(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubExtras();
  }, []);

  useEffect(() => {
    const clientLink = window.location.origin;
    QRCode.toDataURL(clientLink, { width: 300, margin: 2 })
      .then(url => {
        setQrCodeUrl(url);
      })
      .catch(err => {
        console.error('Error generating QR code', err);
      });
  }, []);

  const [newFormula, setNewFormula] = useState('');
  const [formulaPhotos, setFormulaPhotos] = useState<string[]>([]);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const t = {
    nav: {
      agenda: 'Unified Agenda',
      finance: 'Finance',
      professionals: 'Professionals',
      workingHours: 'Working Hours',
      categories: 'Categories',
      services: 'Services & Catalog',
      feedback: 'Follow-ups',
      anamnese: 'Anamnese Forms',
      customers: 'My Customers',
      blacklist: 'Blacklist',
      waitlist: 'Waitlist',
      cancellation: 'Cancellation Requests',
      holidays: 'Holidays & Time Off',
      seo: 'SEO AI Assistant',
      settings: 'App Settings',
      logout: 'Logout'
    },
    orders: {
      title: 'Unified Agenda',
      subtitle: 'Manage all professional schedules in one place',
      manualBooking: 'Manual Booking',
      searchPlaceholder: 'Search by client or service...',
      allProfessionals: 'All Professionals',
      tabs: {
        pending: 'Pending',
        confirmed: 'Confirmed',
        completed: 'Completed',
        cancelled: 'Cancelled'
      }
    },
    common: {
      save: 'Save Changes',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      back: 'Back',
      continue: 'Continue',
      confirm: 'Confirm',
      loading: 'Loading...',
      total: 'Total',
      date: 'Date',
      time: 'Time',
      status: 'Status',
      actions: 'Actions'
    }
  };

  const getAvailableSlots = (dateStr: string, profId: string, duration: number, isAdmin?: boolean) => {
    if (!dateStr || !profId) return [];

    const date = new Date(dateStr + 'T00:00:00');
    const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = daysList[date.getDay()];
    const prof = professionals.find(p => p.id === profId);
    let daySchedule = prof?.workingHours?.[dayOfWeek as keyof WorkingHours];

    if (!daySchedule) {
      daySchedule = settings.workingHours?.[dayOfWeek as keyof WorkingHours] || { isOpen: true, start: '09:00', end: '18:00' };
    }

    const dP2 = dateStr.split('-');
    const formattedDateForLoop = `${dP2[1]}/${dP2[2]}/${dP2[0]}`;
    const relevantExtras = horariosExtras.filter(h => 
      h.profId === profId && 
      h.date === formattedDateForLoop
    );

    if (!isAdmin && !daySchedule.isOpen && relevantExtras.length === 0) return [];

    const slots: string[] = [];
    let loopStart = (daySchedule.isOpen || isAdmin) ? (daySchedule.start || '09:00') : '23:59';
    let loopEnd = (daySchedule.isOpen || isAdmin) ? (daySchedule.end || '18:00') : '00:00';

    if (isAdmin) {
      if (loopStart > '06:00') loopStart = '06:00';
      if (loopEnd < '22:00') loopEnd = '22:00';
    }

    relevantExtras.forEach(h => {
      if (h.start < loopStart) loopStart = h.start;
      if (h.end > loopEnd) loopEnd = h.end;
    });

    if (loopStart === '23:59' && relevantExtras.length === 0) return [];

    let current = new Date(`${dateStr}T${loopStart}:00`);
    const end = new Date(`${dateStr}T${loopEnd}:00`);

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

    while (current < end) {
      const timeStr = current.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      
      const isOccupied = orders.some(order => {
        if (order.status === 'cancelled' || order.status === 'no-show') return false;
        return order.items.some(item => {
          const itemDate = item.appointmentDate || order.appointmentDate;
          if (itemDate !== dateStr) return false;

          const isProfBusy = item.professionalId === profId || (!item.professionalId && profId);
          if (!isProfBusy) return false;

          const itemStart = formatTimeForDate(item.appointmentTime || order.appointmentTime, dateStr);
          if (!itemStart || isNaN(itemStart.getTime())) return false;

          const itemDur = (item.duration || 0) * (item.quantity || 1);
          const itemEnd = new Date(itemStart.getTime() + itemDur * 60000);
          return current >= itemStart && current < itemEnd;
        });
      });

      if (!isOccupied) {
        const slotEnd = new Date(current.getTime() + duration * 60000);
        if (slotEnd <= end) {
          const overlaps = orders.some(order => {
            if (order.status === 'cancelled' || order.status === 'no-show') return false;
            return order.items.some(item => {
              const itemDate = item.appointmentDate || order.appointmentDate;
              if (itemDate !== dateStr) return false;

              const isProfBusy = item.professionalId === profId || (!item.professionalId && profId);
              if (!isProfBusy) return false;

              const itemStart = formatTimeForDate(item.appointmentTime || order.appointmentTime, dateStr);
              if (!itemStart || isNaN(itemStart.getTime())) return false;

              const itemDur = (item.duration || 0) * (item.quantity || 1);
              const itemEnd = new Date(itemStart.getTime() + itemDur * 60000);
              return (current < itemEnd && slotEnd > itemStart);
            });
          });

          if (!overlaps) {
             const extraSlot = relevantExtras.find(h => 
                current >= new Date(`${dateStr}T${h.start}:00`) &&
                slotEnd <= new Date(`${dateStr}T${h.end}:00`)
             );

             if (extraSlot) {
                slots.push(timeStr);
             } else if (daySchedule.isOpen || isAdmin) {
                const slotTime = new Date(`${dateStr}T${timeStr}:00`);
                const busStart = new Date(`${dateStr}T${isAdmin ? loopStart : daySchedule.start}:00`);
                const busEnd = new Date(`${dateStr}T${isAdmin ? loopEnd : daySchedule.end}:00`);
                if (slotTime >= busStart && slotEnd <= busEnd) {
                  slots.push(timeStr);
                }
             }
          }
        }
      }
      current = new Date(current.getTime() + 30 * 60000);
    }
    return slots;
  };

  const getAvailableSlotsForConsecutiveItems = (dateStr: string, items: any[]) => {
    if (!dateStr || !items || items.length === 0) return [];

    const date = new Date(dateStr + 'T00:00:00');
    const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = daysList[date.getDay()];

    const slots: string[] = [];
    let current = new Date(`${dateStr}T06:00:00`);
    const end = new Date(`${dateStr}T22:00:00`);

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

    while (current < end) {
      const timeStr = current.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      
      let possible = true;
      let tempCurrentTime = timeStr;

      for (let k = 0; k < items.length; k++) {
        const item = items[k];
        const profId = item.professionalId;
        if (!profId) {
          possible = false;
          break;
        }

        const itemDur = (item.duration || 0) * (item.quantity || 1);
        const itemStart = formatTimeForDate(tempCurrentTime, dateStr);
        if (!itemStart) {
          possible = false;
          break;
        }
        const itemEnd = new Date(itemStart.getTime() + itemDur * 60000);

        const prof = professionals.find(p => p.id === profId);
        let daySchedule = prof?.workingHours?.[dayOfWeek as keyof WorkingHours];
        if (!daySchedule) {
          daySchedule = settings.workingHours?.[dayOfWeek as keyof WorkingHours] || { isOpen: true, start: '09:00', end: '18:00' };
        }

        const isHoliday = (settings.holidays || []).some((h: any) => {
          if (typeof h === 'string') return h === dateStr;
          if (h.date !== dateStr) return false;
          if (!h.professionalId) {
            const isDeptMatch = h.departments.includes('all') || (item.department && h.departments.includes(item.department));
            return isDeptMatch && !h.startTime && !h.endTime;
          }
          return h.professionalId === profId && !h.startTime && !h.endTime;
        });

        if (isHoliday) {
          possible = false;
          break;
        }

        const isBlockedPeriod = (settings.holidays || []).some((h: any) => {
          if (typeof h === 'string') return false;
          if (h.date !== dateStr) return false;
          if (!h.startTime || !h.endTime) return false;
          if (h.professionalId && h.professionalId !== profId) return false;
          if (!h.professionalId) {
            const isDeptMatch = h.departments.includes('all') || (item.department && h.departments.includes(item.department));
            if (!isDeptMatch) return false;
          }
          const bStart = new Date(`${dateStr}T${h.startTime}:00`);
          const bEnd = new Date(`${dateStr}T${h.endTime}:00`);
          return itemStart < bEnd && itemEnd > bStart;
        });

        if (isBlockedPeriod) {
          possible = false;
          break;
        }

        const dP2 = dateStr.split('-');
        const formattedDateForLoop = `${dP2[1]}/${dP2[2]}/${dP2[0]}`;
        const relevantExtras = (horariosExtras || []).filter(he => 
          he.profId === profId && 
          he.date === formattedDateForLoop
        );

        const hasAuthorizedManualSlot = relevantExtras.some(he => {
          const extraStart = new Date(`${dateStr}T${he.start}:00`);
          const extraEnd = new Date(`${dateStr}T${he.end}:00`);
          return itemStart >= extraStart && itemEnd <= extraEnd;
        });

        const isOccupied = !hasAuthorizedManualSlot && orders.some(order => {
          if (order.status === 'cancelled' || order.status === 'no-show') return false;
          if (isEditingOrder && order.id === isEditingOrder.id) return false;

          return order.items.some(existingItem => {
            const existingItemDate = existingItem.appointmentDate || order.appointmentDate;
            if (existingItemDate !== dateStr) return false;

            const isProfBusy = existingItem.professionalId === profId || (!existingItem.professionalId && profId);
            if (!isProfBusy) return false;

            const existingStart = formatTimeForDate(existingItem.appointmentTime || order.appointmentTime, dateStr);
            if (!existingStart || isNaN(existingStart.getTime())) return false;

            const existingDur = (existingItem.duration || 0) * (existingItem.quantity || 1);
            const existingEnd = new Date(existingStart.getTime() + existingDur * 60000);
            
            const overlap = itemStart < existingEnd && itemEnd > existingStart;
            if (overlap && order.gapStart && order.gapEnd) {
              const gS = formatTimeForDate(order.gapStart, dateStr);
              const gE = formatTimeForDate(order.gapEnd, dateStr);
              if (gS && gE && itemStart >= gS && itemEnd <= gE) return false;
            }
            return overlap;
          });
        });

        if (isOccupied) {
          possible = false;
          break;
        }

        let loopStart = (daySchedule.isOpen) ? (daySchedule.start || '09:00') : '23:59';
        let loopEnd = (daySchedule.isOpen) ? (daySchedule.end || '18:00') : '00:00';
        
        if (loopStart > '06:00') loopStart = '06:00';
        if (loopEnd < '22:00') loopEnd = '22:00';

        relevantExtras.forEach(he => {
          if (he.start < loopStart) loopStart = he.start;
          if (he.end > loopEnd) loopEnd = he.end;
        });

        const busStart = new Date(`${dateStr}T${loopStart}:00`);
        const busEnd = new Date(`${dateStr}T${loopEnd}:00`);

        if (itemStart < busStart || itemEnd > busEnd) {
          possible = false;
          break;
        }

        tempCurrentTime = addMinutesToTime(tempCurrentTime, itemDur);
      }

      if (possible) {
        slots.push(timeStr);
      }

      current = new Date(current.getTime() + 15 * 60000);
    }

    return slots;
  };

  const [isEditingProduct, setIsEditingProduct] = useState<Product | null>(null);
  const [newProduct, setNewProduct] = useState<Omit<Product, 'id'>>({
    title: '',
    description: '',
    price: 0,
    oldPrice: 0,
    duration: 0,
    gender: 'feminino',
    image: '',
    categoryId: '',
    isMeal: false,
    ingredients: '',
    allowedSides: [],
    isActive: true,
    preInstruction: '',
    postInstruction: '',
    anamneseFormId: '',
    maintenanceDays: 0,
    variations: [], 
    priceType: 'fixed'
  });
  const [priceInput, setPriceInput] = useState('');
  const [durationHours, setDurationHours] = useState<string>('');
  const [durationMinutes, setDurationMinutes] = useState<string>('');

  const [isEditingCategory, setIsEditingCategory] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState<{title: string, order: number, department?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic'}>({ title: '', order: 0 });

  const [copied, setCopied] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerDeptFilter, setCustomerDeptFilter] = useState<'all' | 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic'>('all');
  const [orderDeptFilter, setOrderDeptFilter] = useState<'all' | 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic'>('all');
  const [showBirthdaysOnly, setShowBirthdaysOnly] = useState(false);
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'no-show'>('pending');
  const [isEditingOrder, setIsEditingOrder] = useState<Order | null>(null);
  const [isEditingCustomer, setIsEditingCustomer] = useState<any | null>(null);
  const [editCustomerForm, setEditCustomerForm] = useState<any>({});
  const [editOrderForm, setEditOrderForm] = useState<Partial<Order>>({});
  const [oldPriceInput, setOldPriceInput] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayDepts, setNewHolidayDepts] = useState<('all' | 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic')[]>(['all']);
  const [newHolidayProfId, setNewHolidayProfId] = useState('all');
  const [newHolidayStartTime, setNewHolidayStartTime] = useState('');
  const [newHolidayEndTime, setNewHolidayEndTime] = useState('');

  const [isOpeningGap, setIsOpeningGap] = useState<Order | null>(null);
  const [gapInput, setGapInput] = useState({ start: '', end: '' });

  const currentDepartment = undefined;
  const [expandedOrders, setExpandedOrders] = useState<string[]>([]);
  const [expandedCustomers, setExpandedCustomers] = useState<string[]>([]);
  const [isAttendingOrder, setIsAttendingOrder] = useState<Order | null>(null);
  const [noShowCustomFee, setNoShowCustomFee] = useState<string>('');
  const [noShowCustomInstructions, setNoShowCustomInstructions] = useState<string>('');

  useEffect(() => {
    if (isAttendingOrder) {
      setNoShowCustomFee(settings.noShowFee?.toString() || '25');
      setNoShowCustomInstructions(settings.noShowPaymentInstructions || '');
    }
  }, [isAttendingOrder, settings.noShowFee, settings.noShowPaymentInstructions]);

  const sessionItems = useMemo(() => {
    if (!isAttendingOrder) return [];
    const isFilterActive = orderProfessionalFilter !== 'all';
    return isFilterActive 
      ? isAttendingOrder.items.filter(item => item.professionalId === orderProfessionalFilter)
      : isAttendingOrder.items;
  }, [isAttendingOrder, orderProfessionalFilter]);

  const sessionSubtotal = useMemo(() => {
    return sessionItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  }, [sessionItems]);
  const [isGeneratingSEO, setIsGeneratingSEO] = useState(false);
  const [reminderMode, setReminderMode] = useState<'today' | '48h' | 'custom' | null>(null);
  const [attendingStep, setAttendingStep] = useState(1);
  const [showGiftVoucher, setShowGiftVoucher] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const uniqueCustomers = useMemo(() => {
    const customerMap = new Map<string, {
      name: string;
      phone: string;
      instagram?: string;
      email: string;
      birthday: string;
      address: string;
      orderLanguage?: string;
      lastOrder: any;
      totalOrders: number;
      departments: Set<string>;
    }>();

    orders.forEach(order => {
      const key = (order.phone || order.email || order.customerName).toLowerCase();
      const orderDepts = order.items?.map(i => i.department).filter(Boolean) || [];

      if (!customerMap.has(key)) {
        customerMap.set(key, {
          name: order.customerName,
          phone: order.phone,
          instagram: order.instagram,
          email: order.email,
          birthday: order.birthday,
          address: order.address,
          orderLanguage: order.orderLanguage,
          lastOrder: order.createdAt,
          totalOrders: 1,
          departments: new Set(orderDepts as string[])
        });
      } else {
        const existing = customerMap.get(key)!;
        existing.totalOrders += 1;
        orderDepts.forEach(d => existing.departments.add(d as string));
        if (order.createdAt?.toDate && existing.lastOrder?.toDate) {
          if (order.createdAt.toDate() > existing.lastOrder.toDate()) {
            existing.lastOrder = order.createdAt;
            existing.name = order.customerName;
            existing.instagram = order.instagram;
            existing.birthday = order.birthday;
            existing.address = order.address;
            existing.orderLanguage = order.orderLanguage;
          }
        }
      }
    });

    return Array.from(customerMap.values());
  }, [orders]);

  const customMessageClients = useMemo(() => {
    const map = new Map<string, { name: string; phone: string; email?: string }>();
    
    uniqueCustomers.forEach(c => {
      const key = (c.phone || c.name).toLowerCase().trim();
      if (key) {
        map.set(key, { name: c.name, phone: c.phone, email: c.email });
      }
    });

    customerRecords.forEach(r => {
      const key = (r.phone || r.name).toLowerCase().trim();
      if (key && !map.has(key)) {
        map.set(key, { name: r.name, phone: r.phone, email: r.email });
      }
    });

    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

    if (orderProfessionalFilter !== 'all') {
      return list.filter(c => {
        return orders.some(order => {
          const isCustomer = (c.phone && order.phone === c.phone) || 
                             (order.customerName.toLowerCase().trim() === c.name.toLowerCase().trim());
          if (!isCustomer) return false;
          return order.items?.some(i => i.professionalId === orderProfessionalFilter);
        });
      });
    }

    return list;
  }, [uniqueCustomers, customerRecords, orderProfessionalFilter, orders]);

  const retornoItems = useMemo(() => {
    const completedOrders = orders.filter(o => o.status === 'completed');
    const items: {
      orderId: string;
      customerName: string;
      phone: string;
      procedure: string;
      lastDate: Date;
      daysSince: number;
      maintenanceDays: number;
      expiryDate: Date;
      reminderDate: Date;
    }[] = [];

    completedOrders.forEach(order => {
      let orderDate: Date | null = null;
      if (order.createdAt?.toDate) {
        orderDate = order.createdAt.toDate();
        orderDate.setHours(0, 0, 0, 0);
      } else if (order.pickupDate) {
        orderDate = parseDateString(order.pickupDate, order.orderLanguage || settings.language || 'pt');
      }
      
      if (!orderDate) return;

      order.items.forEach(item => {
        const product = products.find(p => p.title === item.title || p.id === item.productId);
        const mDays = product?.maintenanceDays || 30;
        const reminderDay = Math.max(1, mDays - 5);

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const diffTime = now.getTime() - orderDate!.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        // We show reminders that are between reminderDay and the expiry
        if (diffDays >= reminderDay && diffDays <= mDays + 2) {
          const expiryDate = new Date(orderDate!);
          expiryDate.setDate(expiryDate.getDate() + mDays);
          
          const reminderDate = new Date(orderDate!);
          reminderDate.setDate(reminderDate.getDate() + reminderDay);

          items.push({
            orderId: order.id,
            customerName: order.customerName,
            phone: order.phone,
            procedure: item.title,
            lastDate: orderDate!,
            daysSince: diffDays,
            maintenanceDays: mDays,
            expiryDate,
            reminderDate
          });
        }
      });
    });

    return items.sort((a, b) => b.daysSince - a.daysSince);
  }, [orders, products, settings.language]);

  const calendarWeek = useMemo(() => {
    const start = new Date(calendarDate);
    const day = start.getDay();
    const diff = start.getDate() - day;
    const sunday = new Date(start.setDate(diff));
    sunday.setHours(0, 0, 0, 0);
    
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [calendarDate]);

  const slugify = (text: string) => {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-');
  };

  const handleBrandNameChange = (name: string) => {
    setSettings(prev => ({
      ...prev,
      brandName: name,
      slug: slugify(name)
    }));
  };

  const handleWhatsappChange = (value: string) => {
    const digits = value.replace(/\D/g, '');
    let formatted = digits;
    
    // USA: (XXX) XXX-XXXX
    if (digits.length <= 10) {
      formatted = digits.replace(/^(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
      if (digits.length > 3 && digits.length <= 6) {
        formatted = digits.replace(/^(\d{3})(\d+)/, '($1) $2');
      } else if (digits.length > 6) {
        formatted = digits.replace(/^(\d{3})(\d{3})(\d+)/, '($1) $2-$3');
      } else if (digits.length > 0) {
        formatted = `(${digits}`;
      }
    } else {
      formatted = digits.slice(0, 10).replace(/^(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
    }
    
    setSettings(prev => ({ ...prev, whatsappNumber: formatted }));
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    setLoading(true);

    const unsubProducts = onSnapshot(query(collection(db, 'produtos'), orderBy('title')), (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
      setLoading(false);
    });

    const unsubCategories = onSnapshot(query(collection(db, 'categorias'), orderBy('order', 'asc')), (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });

    const unsubOrders = onSnapshot(query(collection(db, 'pedidos'), orderBy('createdAt', 'desc')), (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
    });

    const unsubSides = onSnapshot(collection(db, 'acompanhamentos'), (snapshot) => {
      setSides(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Side)));
    });

    const unsubRecords = onSnapshot(collection(db, 'clientes_historico'), (snapshot) => {
      setCustomerRecords(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CustomerRecord)));
    });

    const unsubForms = onSnapshot(collection(db, 'anamnese_forms'), (snapshot) => {
      setAnamneseForms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AnamneseForm)));
    });

    const unsubProfessionals = onSnapshot(query(collection(db, 'profissionais'), orderBy('order', 'asc')), (snapshot) => {
      setProfessionals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Professional)));
    });

    const unsubBlacklist = onSnapshot(collection(db, 'blacklist'), (snapshot) => {
      setBlacklist(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BlacklistRecord)));
    });

    const unsubWaitlist = onSnapshot(query(collection(db, 'waitlist'), orderBy('createdAt', 'desc')), (snapshot) => {
      setWaitlist(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubCancellation = onSnapshot(query(collection(db, 'cancellation_requests'), orderBy('createdAt', 'desc')), (snapshot) => {
      setCancellationRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubProducts();
      unsubCategories();
      unsubOrders();
      unsubSides();
      unsubRecords();
      unsubForms();
      unsubProfessionals();
      unsubBlacklist();
      unsubWaitlist();
      unsubCancellation();
    };
  }, [isLoggedIn]);

  // Automatic background migration to adjust older appointments to consecutive times
  useEffect(() => {
    if (!orders || orders.length === 0) return;

    const activeOrders = orders.filter(o => o.status !== 'cancelled');
    const ordersToFix = activeOrders.filter(order => {
      if (!order.items || order.items.length <= 1) return false;
      const baseTime = order.appointmentTime;
      if (!baseTime) return false;

      // Filter non-empty appointmentTimes for the items
      const times = order.items.map(i => i.appointmentTime).filter(Boolean);
      const uniqueTimes = Array.from(new Set(times));

      // If the items are already scheduled at different custom times (e.g. 11:00 AM and 12:30 PM),
      // they do not need any consecutive adjustment. Return false to keep them intact.
      if (uniqueTimes.length > 1) return false;

      // Check if we need to adjust: if any subsequent item has appointmentTime equal to baseTime,
      // or if it lacks appointmentTime, which indicates it wasn't consecutively scheduled.
      let needsAdjustment = false;
      for (let k = 1; k < order.items.length; k++) {
        const item = order.items[k];
        if (!item.appointmentTime || item.appointmentTime === baseTime) {
          needsAdjustment = true;
          break;
        }
      }
      return needsAdjustment;
    });

    if (ordersToFix.length > 0) {
      ordersToFix.forEach(async (order) => {
        let currentTime = order.appointmentTime;
        const consecutiveItems = order.items.map((item) => {
          const itemTime = currentTime;
          const itemDuration = item.duration || 30;
          currentTime = addMinutesToTime(currentTime, itemDuration * (item.quantity || 1));
          return {
            ...item,
            appointmentTime: itemTime,
            appointmentDate: item.appointmentDate || order.appointmentDate
          };
        });

        try {
          await updateDoc(doc(db, 'pedidos', order.id), {
            items: consecutiveItems
          });
          console.log(`Auto-migrated old order consecutive times for order ID: ${order.id}`);
        } catch (err) {
          console.error(`Error auto-migrating order ${order.id}:`, err);
        }
      });
    }
  }, [orders]);

  // Automatic background migration for existing manual slots date format to MM/DD/YYYY
  useEffect(() => {
    if (!horariosExtras || horariosExtras.length === 0) return;

    horariosExtras.forEach(async (h) => {
      if (!h.date) return;
      const parts = h.date.split('/');
      if (parts.length === 3) {
        const first = parseInt(parts[0], 10);
        
        let shouldMigrate = false;
        if (first > 12) {
          shouldMigrate = true;
        } else if (h.date === '09/07/2026') {
          shouldMigrate = true;
        }

        if (shouldMigrate) {
          const newDate = `${parts[1].padStart(2, '0')}/${parts[0].padStart(2, '0')}/${parts[2]}`;
          try {
            await updateDoc(doc(db, 'horarios_extras', h.id), {
              date: newDate
            });
            console.log(`Auto-migrated extra slot date from ${h.date} to ${newDate}`);
          } catch (err) {
            console.error(`Error migrating extra slot date for ${h.id}:`, err);
          }
        }
      }
    });
  }, [horariosExtras]);

  const handleDeptLogin = () => {};
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const correctPassword = settings?.adminPassword || 'admin123';
    if (password === correctPassword) {
      try {
        await signInAnonymously(auth);
        setIsLoggedIn(true);
        toast.success('Login successful!');
      } catch (error) {
        console.error('Error authenticating with Firebase:', error);
        toast.error('Error connecting to server. Please try again.');
      }
    } else {
      toast.error('Incorrect password!');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, callback: (base64: string) => void, isGallery: boolean = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_WIDTH = isGallery ? 700 : 900;
          const MAX_HEIGHT = isGallery ? 700 : 900;
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', isGallery ? 0.5 : 0.6);
          callback(compressedBase64);
        };
      };
      reader.readAsDataURL(file);
    }
  };

  const saveHolidaysToFirestore = async (nextHolidays: (string | Holiday)[]) => {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    const cleanHolidays = JSON.parse(JSON.stringify(nextHolidays));
    await setDoc(doc(db, 'configuracoes', 'bloqueios'), {
      holidays: cleanHolidays,
      migrated: true,
    });
    try {
      await updateDoc(doc(db, 'configuracoes', 'geral'), {
        holidays: deleteField(),
      });
    } catch (cleanupErr) {
      console.warn('Could not clean legacy holidays from geral:', cleanupErr);
    }
    setSettings(prev => ({ ...prev, holidays: cleanHolidays }));
  };

  const compressDataUrlIfLarge = (value?: string, maxDim: number = 700, quality: number = 0.6): Promise<string | undefined> => {
    if (!value || !value.startsWith('data:image/') || value.length < 180_000) {
      return Promise.resolve(value);
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else if (height > maxDim) {
          width *= maxDim / height;
          height = maxDim;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(value);
      img.src = value;
    });
  };

  const saveSettings = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }

      const {
        holidays,
        seoAnalysis,
        seoHistory,
        logo,
        backgroundImage,
        hairIcon,
        makeupIcon,
        nailsIcon,
        spaIcon,
        clinicIcon,
        aestheticIcon,
        zelleQR,
        venmoQR,
        paypalQR,
        debitCardQR,
        creditCardQR,
        pixQR,
        ...coreSettings
      } = settings;

      const [
        cLogo, cHairIcon, cMakeupIcon, cNailsIcon, cSpaIcon, cClinicIcon, cAestheticIcon,
        cBg,
        cZelle, cVenmo, cPaypal, cDebit, cCredit, cPix
      ] = await Promise.all([
        compressDataUrlIfLarge(logo, 600, 0.65),
        compressDataUrlIfLarge(hairIcon, 500, 0.6),
        compressDataUrlIfLarge(makeupIcon, 500, 0.6),
        compressDataUrlIfLarge(nailsIcon, 500, 0.6),
        compressDataUrlIfLarge(spaIcon, 500, 0.6),
        compressDataUrlIfLarge(clinicIcon, 500, 0.6),
        compressDataUrlIfLarge(aestheticIcon, 500, 0.6),
        compressDataUrlIfLarge(backgroundImage, 900, 0.6),
        compressDataUrlIfLarge(zelleQR, 500, 0.65),
        compressDataUrlIfLarge(venmoQR, 500, 0.65),
        compressDataUrlIfLarge(paypalQR, 500, 0.65),
        compressDataUrlIfLarge(debitCardQR, 500, 0.65),
        compressDataUrlIfLarge(creditCardQR, 500, 0.65),
        compressDataUrlIfLarge(pixQR, 500, 0.65),
      ]);

      const cleanCore = JSON.parse(JSON.stringify(coreSettings));
      const cleanMidia = JSON.parse(JSON.stringify({
        logo: cLogo,
        hairIcon: cHairIcon,
        makeupIcon: cMakeupIcon,
        nailsIcon: cNailsIcon,
        spaIcon: cSpaIcon,
        clinicIcon: cClinicIcon,
        aestheticIcon: cAestheticIcon,
        migrated: true,
      }));
      const cleanFundo = JSON.parse(JSON.stringify({
        backgroundImage: cBg,
        migrated: true,
      }));
      const cleanPagamentos = JSON.parse(JSON.stringify({
        zelleQR: cZelle,
        venmoQR: cVenmo,
        paypalQR: cPaypal,
        debitCardQR: cDebit,
        creditCardQR: cCredit,
        pixQR: cPix,
        migrated: true,
      }));
      const cleanSeo = JSON.parse(JSON.stringify({
        seoAnalysis: seoAnalysis || '',
        seoHistory: seoHistory || [],
        migrated: true,
      }));
      const cleanHolidays = JSON.parse(JSON.stringify(holidays || []));

      await Promise.all([
        setDoc(doc(db, 'configuracoes', 'midia'), cleanMidia),
        setDoc(doc(db, 'configuracoes', 'fundo'), cleanFundo),
        setDoc(doc(db, 'configuracoes', 'pagamentos'), cleanPagamentos),
        setDoc(doc(db, 'configuracoes', 'seo'), cleanSeo),
        setDoc(doc(db, 'configuracoes', 'bloqueios'), { holidays: cleanHolidays, migrated: true }),
      ]);

      await setDoc(doc(db, 'configuracoes', 'geral'), cleanCore);
      toast.success('Settings saved successfully!');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error saving settings:', err);
      toast.error('Error saving: ' + (err.message || 'Check permissions'));
    } finally {
      setTimeout(() => setIsSaving(false), 500);
    }
  };

  const generateSEO = async () => {
    if (!settings.businessDescription) {
      toast.error('Please describe your business first.');
      return;
    }
    setIsGeneratingSEO(true);
    try {
      const ai = new GoogleGenAI({ apiKey: (process.env as any).GEMINI_API_KEY });
      const prompt = `
        You are a senior SEO and digital marketing expert for beauty salons.
        Based on the business description below, provide a complete SEO report in English.
        
        Business Description: ${settings.businessDescription}
        
        The report must include:
        1. 10 High-volume, low-difficulty keywords.
        2. One irresistible Title Tag suggestion.
        3. One optimized Meta-Description.
        4. Content tips for blog/social media to attract local clients.
        5. Tips on how to optimize results in Google Business Profile (Google My Business).
        
        Format the result in elegant Markdown, using headers, lists, and bold.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      if (response.text) {
        const newReport = {
          id: Date.now().toString(),
          date: new Date().toLocaleString('en-US'),
          businessDescription: settings.businessDescription,
          analysis: response.text
        };
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
        const newHistory = [newReport, ...(settings.seoHistory || [])];
        const newSettings = { 
          ...settings, 
          seoAnalysis: response.text, 
          seoHistory: newHistory
        };
        await setDoc(doc(db, 'configuracoes', 'seo'), JSON.parse(JSON.stringify({
          seoAnalysis: response.text,
          seoHistory: newHistory,
          migrated: true,
        })));
        try {
          await updateDoc(doc(db, 'configuracoes', 'geral'), {
            seoAnalysis: deleteField(),
            seoHistory: deleteField(),
          });
        } catch (cleanupErr) {
          console.warn('Could not clean legacy seo from geral:', cleanupErr);
        }
        setSettings(newSettings);
        toast.success('SEO report generated successfully!');
      }
    } catch (error) {
      console.error('Error generating SEO:', error);
      toast.error('Failed to generate SEO report. Check your connection.');
    } finally {
      setIsGeneratingSEO(false);
    }
  };

  const deleteSEOReport = async (reportId: string) => {
    const newHistory = settings.seoHistory?.filter(r => r.id !== reportId) || [];
    const newSeoAnalysis = settings.seoHistory?.find(r => r.id === reportId)?.analysis === settings.seoAnalysis 
      ? (newHistory[0]?.analysis || '') 
      : settings.seoAnalysis;
    const newSettings = { 
      ...settings, 
      seoHistory: newHistory,
      // If deleting the current active analysis, set to most recent or empty
      seoAnalysis: newSeoAnalysis
    };
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }
    await setDoc(doc(db, 'configuracoes', 'seo'), JSON.parse(JSON.stringify({
      seoHistory: newHistory,
      seoAnalysis: newSeoAnalysis || '',
      migrated: true,
    })));
    try {
      await updateDoc(doc(db, 'configuracoes', 'geral'), {
        seoAnalysis: deleteField(),
        seoHistory: deleteField(),
      });
    } catch (cleanupErr) {
      console.warn('Could not clean legacy seo from geral:', cleanupErr);
    }
    setSettings(newSettings);
    toast.success('Report deleted.');
  };

  const handlePriceChange = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) {
      setPriceInput('0.00');
      setNewProduct(prev => ({ ...prev, price: 0 }));
      return;
    }
    const numericValue = parseInt(digits) / 100;
    const formatted = numericValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setPriceInput(formatted);
    setNewProduct(prev => ({ ...prev, price: numericValue }));
  };

  const handleOldPriceChange = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) {
      setOldPriceInput('0.00');
      setNewProduct(prev => ({ ...prev, oldPrice: 0 }));
      return;
    }
    const numericValue = parseInt(digits) / 100;
    const formatted = numericValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setOldPriceInput(formatted);
    setNewProduct(prev => ({ ...prev, oldPrice: numericValue }));
  };

  const resetProductForm = () => {
    setNewProduct({ 
      title: '', description: '', price: 0, image: '', categoryId: '', isMeal: false,
      ingredients: '', allowedSides: [], isActive: true, oldPrice: 0, duration: 0, gender: 'feminino',
      preInstruction: '', postInstruction: '', anamneseFormId: '',
      maintenanceDays: 0,
      variations: [], priceType: 'fixed'
    });
    setPriceInput('');
    setOldPriceInput('');
    setDurationHours('');
    setDurationMinutes('');
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!newProduct.title || !newProduct.categoryId) {
        toast.error('Please fill in the title and category.');
        return;
      }

      const totalDuration = ((parseInt(durationHours) || 0) * 60) + (parseInt(durationMinutes) || 0);

      const productData = { 
        ...newProduct, 
        department: currentDepartment || newProduct.department 
      };

      if (isEditingProduct) {
        await updateDoc(doc(db, 'produtos', isEditingProduct.id), {
          ...productData,
          duration: totalDuration
        });
        setIsEditingProduct(null);
        toast.success('Service updated successfully!');
      } else {
        await addDoc(collection(db, 'produtos'), { 
          ...productData, 
          isActive: true,
          duration: totalDuration 
        });
        toast.success('Service added successfully!');
      }
      resetProductForm();
    } catch (err) {
      toast.error('Error saving service.');
    }
  };

  const toggleProductStatus = async (product: Product) => {
    try {
      await updateDoc(doc(db, 'produtos', product.id), { isActive: product.isActive === false ? true : false });
    } catch (err) {
      alert('Error changing product status.');
    }
  };

  const moveCategory = async (id: string, direction: 'up' | 'down') => {
    const index = categories.findIndex(c => c.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === categories.length - 1) return;
    const otherIndex = direction === 'up' ? index - 1 : index + 1;
    const current = categories[index];
    const other = categories[otherIndex];
    const currentOrder = current.order ?? index;
    const otherOrder = other.order ?? otherIndex;
    let newCurrentOrder = otherOrder;
    let newOtherOrder = currentOrder;
    if (newCurrentOrder === newOtherOrder) {
      newCurrentOrder = direction === 'up' ? newOtherOrder - 1 : newOtherOrder + 1;
    }
    await updateDoc(doc(db, 'categorias', current.id), { order: newCurrentOrder });
    await updateDoc(doc(db, 'categorias', other.id), { order: newOtherOrder });
  };

  const handleAddSide = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSide.name) return;
    try {
      if (isEditingSide) {
        await updateDoc(doc(db, 'acompanhamentos', isEditingSide.id), newSide);
        toast.success('Acompanhamento atualizado!');
      } else {
        await addDoc(collection(db, 'acompanhamentos'), newSide);
        toast.success('Acompanhamento adicionado!');
      }
      setNewSide({ name: '', price: 0 });
      setSidePriceInput('');
      setIsEditingSide(null);
    } catch (error) {
      toast.error('Error saving tracking info');
    }
  };

  const deleteSide = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Follow-up',
      message: 'Are you sure you want to delete this follow-up?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'acompanhamentos', id));
          toast.success('Acompanhamento excluído!');
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          toast.error('Error deleting');
        }
      }
    });
  };

  const handleSidePriceChange = (val: string) => {
    setSidePriceInput(val);
    const numeric = parseFloat(val.replace(',', '.'));
    if (!isNaN(numeric)) setNewSide({ ...newSide, price: numeric });
  };

  const handleAddCategory = async (e: React.FormEvent, dept?: 'hair' | 'makeup' | 'nails' | 'spa' | 'clinic' | 'aesthetic') => {
    e.preventDefault();
    try {
      if (!newCategory.title) {
        toast.error('Please fill in the category title.');
        return;
      }
      if (isEditingCategory) {
        await updateDoc(doc(db, 'categorias', isEditingCategory.id), { 
          title: newCategory.title,
          department: newCategory.department || dept
        });
        setIsEditingCategory(null);
        toast.success('Category updated successfully!');
      } else {
        const maxOrder = categories.reduce((max, c) => Math.max(max, c.order || 0), 0);
        await addDoc(collection(db, 'categorias'), { 
          title: newCategory.title, 
          order: maxOrder + 1,
          department: dept || newCategory.department
        });
        toast.success('Category added successfully!');
      }
      setNewCategory({ title: '', order: 0 });
    } catch (err: any) {
      toast.error('Error saving category.');
    }
  };

  const seedTestData = async () => {
    setIsSeeding(true);
    try {
      const catRefs: { [key: string]: string } = {};
      const demoCats = [
        { title: 'Estética Facial', dept: 'aesthetic' },
        { title: 'Cabelo & Cor', dept: 'hair' },
        { title: 'Manicure & Pedicure', dept: 'nails' },
        { title: 'Maquiagem Profissional', dept: 'makeup' },
        { title: 'Massagem & Relaxamento', dept: 'spa' },
        { title: 'Clínica Especializada', dept: 'clinic' },
        { title: 'Estética Corporal', dept: 'aesthetic' }
      ];

      for (const cat of demoCats) {
        const docRef = await addDoc(collection(db, 'categorias'), { 
          title: cat.title, 
          department: cat.dept, 
          order: 0 
        });
        catRefs[cat.title] = docRef.id;
      }

      const anamneseRef = await addDoc(collection(db, 'anamnese_forms'), {
        title: 'Ficha de Avaliação Estética',
        questions: [
          { id: '1', label: 'Possui alguma alergia?', type: 'text', required: true },
          { id: '2', label: 'Está gestante?', type: 'choice', options: ['Sim', 'Não'], required: true },
          { id: '3', label: 'Usa algum ácido na pele?', type: 'text', required: false }
        ]
      });

      const demoProducts = [
        // Aesthetic
        { title: 'Limpeza de Pele Profunda', category: 'Estética Facial', price: 150, duration: 60, dept: 'aesthetic', maintenance: 30 },
        { title: 'Botox (3 áreas)', category: 'Estética Facial', price: 950, duration: 30, dept: 'aesthetic', maintenance: 120 },
        { title: 'Design de Sobrancelha', category: 'Estética Facial', price: 45, duration: 20, dept: 'aesthetic', maintenance: 20 },
        
        // Hair
        { title: 'Corte Feminino', category: 'Cabelo & Cor', price: 120, duration: 60, dept: 'hair', maintenance: 60 },
        { title: 'Escova & Lavagem', category: 'Cabelo & Cor', price: 65, duration: 40, dept: 'hair', maintenance: 7 },
        { title: 'Mechas / Luzes', category: 'Cabelo & Cor', price: 450, duration: 240, dept: 'hair', maintenance: 90 },
        
        // Nails
        { title: 'Pé e Mão', category: 'Manicure & Pedicure', price: 55, duration: 90, dept: 'nails', maintenance: 15 },
        { title: 'Alongamento em Fibra', category: 'Manicure & Pedicure', price: 180, duration: 150, dept: 'nails', maintenance: 21 },
        { title: 'Blindagem de Diamante', category: 'Manicure & Pedicure', price: 110, duration: 60, dept: 'nails', maintenance: 20 },
        
        // Makeup
        { title: 'Maquiagem Social', category: 'Maquiagem Profissional', price: 250, duration: 90, dept: 'makeup', maintenance: 1 },
        { title: 'Maquiagem para Noivas', category: 'Maquiagem Profissional', price: 850, duration: 180, dept: 'makeup', maintenance: 1 },
        { title: 'Cílios Postiços (Aplicação)', category: 'Maquiagem Profissional', price: 45, duration: 15, dept: 'makeup', maintenance: 1 },
        
        // Spa
        { title: 'Massagem Relaxante', category: 'Massagem & Relaxamento', price: 140, duration: 60, dept: 'spa', maintenance: 15 },
        { title: 'Drenagem Linfática', category: 'Massagem & Relaxamento', price: 160, duration: 60, dept: 'spa', maintenance: 7 },
        { title: 'Day Spa (Pacote)', category: 'Massagem & Relaxamento', price: 450, duration: 180, dept: 'spa', maintenance: 30 },
        
        // Clinic
        { title: 'Harmonização Facial', category: 'Clínica Especializada', price: 1200, duration: 90, dept: 'clinic', maintenance: 180 },
        { title: 'Preenchimento Labial', category: 'Clínica Especializada', price: 850, duration: 45, dept: 'clinic', maintenance: 180 },
        
        // Extra Aesthetic
        { title: 'Criolipólise', category: 'Estética Corporal', price: 350, duration: 60, dept: 'aesthetic', maintenance: 30 },
        { title: 'Depilação a Lazer', category: 'Estética Corporal', price: 120, duration: 30, dept: 'aesthetic', maintenance: 30 }
      ];

      for (const prod of demoProducts) {
        await addDoc(collection(db, 'produtos'), {
          title: prod.title,
          description: 'Procedimento realizado com excelência pela equipe Cris Gasparre.',
          price: prod.price,
          duration: prod.duration,
          categoryId: catRefs[prod.category],
          department: prod.dept,
          isActive: true,
          maintenanceDays: prod.maintenance,
          anamneseFormId: prod.title === 'Limpeza de Pele Profunda' ? anamneseRef.id : '',
          variations: [],
          priceType: 'fixed'
        });
      }

      const now = new Date();
      
      // Seed Professionals if missing
      const profsSnap = await getDocs(collection(db, 'profissionais'));
      let activeProfs = profsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      
      if (activeProfs.length === 0) {
        const demoProfs = [
          { name: 'Sara Costa', departments: ['aesthetic', 'clinic'], order: 1, isActive: true },
          { name: 'Giovana Silva', departments: ['aesthetic', 'hair'], order: 2, isActive: true },
          { name: 'Sabrina Fernandes', departments: ['nails', 'makeup'], order: 3, isActive: true },
          { name: 'Raíssa Lima', departments: ['spa', 'aesthetic'], order: 4, isActive: true },
          { name: 'Julia Santos', departments: ['nails', 'spa'], order: 5, isActive: true }
        ];
        for (const p of demoProfs) {
          const docRef = await addDoc(collection(db, 'profissionais'), p);
          activeProfs.push({ id: docRef.id, ...p });
        }
      }

      const demoOrders = [
        { name: 'Maria Oliveira', phone: '11999999999', procedure: 'Limpeza de Pele Profunda', daysAgo: 26, email: 'maria@test.com', status: 'completed' },
        { name: 'Julia Santos', phone: '11888888888', procedure: 'Pé e Mão', daysAgo: 14, email: 'julia@test.com', status: 'completed' },
        { name: 'Beatriz Costa', phone: '11777777777', procedure: 'Design de Sobrancelha', daysAgo: 18, email: 'beatriz@test.com', status: 'completed' }
      ];

      // Generate many orders for the current week to show in calendar
      const currentWeekOrders = [];
      const days = [-2, -1, 0, 1, 2, 3, 4]; // Around today
      const hours = ['09:00', '10:00', '11:30', '14:00', '15:30', '17:00'];
      const names = ['Ana Silva', 'Carla Mendes', 'Dandara Paz', 'Elena Rocha', 'Fernanda Lima', 'Gisele B', 'Helena M', 'Iara S'];

      for (let i = 0; i < 35; i++) {
        const dayOffset = days[Math.floor(Math.random() * days.length)];
        const hour = hours[Math.floor(Math.random() * hours.length)];
        const name = names[Math.floor(Math.random() * names.length)];
        const prod = demoProducts[Math.floor(Math.random() * demoProducts.length)];
        const prof = activeProfs[Math.floor(Math.random() * activeProfs.length)];

        const date = new Date(now);
        date.setDate(now.getDate() + dayOffset);
        
        currentWeekOrders.push({
          customerName: name,
          phone: '(11) 9' + Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8),
          email: name.toLowerCase().replace(' ', '.') + '@test.com',
          status: dayOffset < 0 ? 'completed' : 'pending',
          items: [{
            title: prod.title,
            quantity: 1,
            price: prod.price,
            productId: 'demo',
            professionalId: prof.id,
            professionalName: prof.name,
            department: prod.dept,
            duration: prod.duration || 60,
            appointmentTime: hour
          }],
          total: prod.price,
          appointmentDate: date.toLocaleDateString('pt-BR'),
          appointmentTime: hour,
          pickupDate: date.toLocaleDateString('pt-BR'),
          pickupTime: hour,
          createdAt: new Date(),
          orderLanguage: 'pt'
        });
      }

      for (const o of demoOrders) {
        const orderDate = new Date(now);
        orderDate.setDate(now.getDate() - o.daysAgo);
        
        await addDoc(collection(db, 'pedidos'), {
          customerName: o.name,
          phone: o.phone,
          email: o.email,
          status: o.status,
          items: [{ 
            title: o.procedure, 
            quantity: 1, 
            price: demoProducts.find(p => p.title === o.procedure)?.price || 0,
            professionalName: activeProfs[0].name,
            professionalId: activeProfs[0].id
          }],
          total: demoProducts.find(p => p.title === o.procedure)?.price || 0,
          pickupDate: orderDate.toLocaleDateString('pt-BR'),
          pickupTime: '14:00',
          appointmentDate: orderDate.toLocaleDateString('pt-BR'),
          appointmentTime: '14:00',
          createdAt: orderDate,
          orderLanguage: 'pt'
        });
      }

      for (const o of currentWeekOrders) {
        await addDoc(collection(db, 'pedidos'), o);
      }

      toast.success('Test data generated successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Error generating data. Check Firebase rules.');
    } finally {
      setIsSeeding(false);
    }
  };

  const deleteProduct = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Product',
      message: 'Do you really want to delete this product?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'produtos', id));
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          alert('Error deleting product.');
        }
      }
    });
  };

  const deleteCategory = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Category',
      message: 'Do you really want to delete this category?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'categorias', id));
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          alert('Error deleting category.');
        }
      }
    });
  };

  const deleteOrder = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Order',
      message: 'Do you really want to delete this order?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'pedidos', id));
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          alert('Error deleting order.');
        }
      }
    });
  };

  const deleteCustomer = async (customer: any) => {
    const customerId = customer.phone || customer.email || customer.name;
    const customerOrders = orders.filter(o => (o.phone || o.email || o.customerName) === customerId);
    try {
      setIsSaving(true);
      for (const order of customerOrders) await deleteDoc(doc(db, 'pedidos', order.id));
      toast.success('Customer and their orders deleted successfully!');
    } catch (error) {
      toast.error('Error deleting customer');
    } finally {
      setIsSaving(false);
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
    }
  };

  const updateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCustomerForm.name?.trim()) {
      toast.error('Customer name is required');
      return;
    }
    const originalId = isEditingCustomer.phone || isEditingCustomer.email || isEditingCustomer.name || '';
    const cleanOriginalId = originalId.replace(/\D/g, '');

    const customerOrders = orders.filter(o => {
      const orderPhone = (o.phone || '').replace(/\D/g, '');
      const orderEmail = (o.email || '').toLowerCase();
      const orderName = (o.customerName || '').toLowerCase();
      
      if (cleanOriginalId && orderPhone === cleanOriginalId) return true;
      if (originalId && orderEmail === originalId.toLowerCase()) return true;
      if (originalId && orderName === originalId.toLowerCase()) return true;
      return false;
    });

    try {
      setIsSaving(true);
      
      // Update orders
      for (const order of customerOrders) {
        await updateDoc(doc(db, 'pedidos', order.id), {
          customerName: editCustomerForm.name?.trim() || '',
          phone: editCustomerForm.phone?.trim() || '',
          email: editCustomerForm.email?.trim() || '',
          birthday: editCustomerForm.birthday?.trim() || '',
          address: editCustomerForm.address?.trim() || '',
          instagram: editCustomerForm.instagram?.trim() || ''
        });
      }

      // Update/Create notes/history record
      const record = customerRecords.find(r => {
        const recordPhone = (r.phone || '').replace(/\D/g, '');
        const recordEmail = (r.email || '').toLowerCase();
        const recordName = (r.name || '').toLowerCase();

        if (cleanOriginalId && recordPhone === cleanOriginalId) return true;
        if (originalId && recordEmail === originalId.toLowerCase()) return true;
        if (originalId && recordName === originalId.toLowerCase()) return true;
        return false;
      });

      if (record) {
        await updateDoc(doc(db, 'clientes_historico', record.id), {
          name: editCustomerForm.name?.trim() || '',
          phone: editCustomerForm.phone?.trim() || '',
          email: editCustomerForm.email?.trim() || '',
          notes: editCustomerForm.notes || '',
          instagram: editCustomerForm.instagram?.trim() || '',
          birthday: editCustomerForm.birthday?.trim() || '',
          address: editCustomerForm.address?.trim() || ''
        });
      } else {
        await addDoc(collection(db, 'clientes_historico'), {
          name: editCustomerForm.name?.trim() || '',
          phone: editCustomerForm.phone?.trim() || '',
          email: editCustomerForm.email?.trim() || '',
          notes: editCustomerForm.notes || '',
          instagram: editCustomerForm.instagram?.trim() || '',
          birthday: editCustomerForm.birthday?.trim() || '',
          address: editCustomerForm.address?.trim() || '',
          formulas: []
        });
      }

      toast.success('Customer information updated!');
      setIsEditingCustomer(null);
    } catch (error: any) {
      console.error("Error updating customer profile:", error);
      toast.error(`Error updating customer: ${error?.message || error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditingOrder) return;
    try {
      await updateDoc(doc(db, 'pedidos', isEditingOrder.id), editOrderForm);
      setIsEditingOrder(null);
    } catch (err) {
      alert('Error updating order.');
    }
  };

  const toggleOrder = (orderId: string) => {
    setExpandedOrders(prev => prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]);
  };

  const copyLink = () => {
    const url = `${window.location.origin}/?slug=${settings?.slug || 'easy-menu'}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const printOrder = (order: Order) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const dateStr = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString('en-US') : 'N/A';
    let itemsHtml = order.items.map(item => `
      <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #ccc; padding: 4px 0;">
        <span>${item.quantity}x ${item.title}</span>
        <span>${currencySymbol} ${(item.price * item.quantity).toFixed(2)}</span>
      </div>
      ${item.mealOptions ? `
        <div style="font-size: 10px; color: #666; margin-left: 10px; margin-bottom: 4px;">
          ${item.mealOptions.removals.length > 0 ? `<div>Remove: ${item.mealOptions.removals.join(', ')}</div>` : ''}
          ${item.mealOptions.sides.length > 0 ? `<div>Add-ons: ${item.mealOptions.sides.map(s => s.name).join(', ')}</div>` : ''}
        </div>
      ` : ''}
    `).join('');
    printWindow.document.write(`
      <html>
        <head>
          <title>Order Ticket - ${order.customerName}</title>
          <style>
            body { font-family: 'Courier New', Courier, monospace; width: 80mm; padding: 5mm; margin: 0; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
            .section { margin-bottom: 10px; }
            .label { font-weight: bold; font-size: 12px; }
            .value { font-size: 12px; }
            .total { text-align: right; font-weight: bold; font-size: 16px; border-top: 2px solid #000; padding-top: 10px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header"><h2>${settings.brandName}</h2><p>${dateStr}</p></div>
          <div class="section"><div class="label">CUSTOMER:</div><div class="value">${order.customerName}</div></div>
          <div class="section"><div class="label">PHONE:</div><div class="value">${order.phone}</div></div>
          <div class="section"><div class="label">ADDRESS:</div><div class="value">${order.address}</div></div>
          <div class="section"><div class="label">ITEMS:</div><div>${itemsHtml}</div></div>
          <div class="total">TOTAL: ${currencySymbol} ${order.total.toFixed(2)}</div>
          <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const isBirthdayThisWeek = (birthdayStr: string, orderLanguage?: string) => {
    if (!birthdayStr) return false;
    const parts = birthdayStr.split('/');
    if (parts.length < 2) return false;
    const lang = orderLanguage || settings.language;
    let day, month;
    if (lang === 'en') {
      month = parseInt(parts[0]) - 1; day = parseInt(parts[1]);
      if (month > 11) { day = parseInt(parts[0]); month = parseInt(parts[1]) - 1; }
    } else {
      day = parseInt(parts[0]); month = parseInt(parts[1]) - 1;
      if (month > 11) { month = parseInt(parts[0]) - 1; day = parseInt(parts[1]); }
    }
    if (isNaN(day) || isNaN(month) || month < 0 || month > 11) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const bdayThisYear = new Date(today.getFullYear(), month, day);
    const diffDays = Math.ceil((bdayThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= 7) return true;
    const bdayNextYear = new Date(today.getFullYear() + 1, month, day);
    const diffDaysNext = Math.ceil((bdayNextYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDaysNext >= 0 && diffDaysNext <= 7;
  };

  const parseDateString = (str: string, lang: string) => {
    if (!str) return null;
    const separator = str.includes('/') ? '/' : (str.includes('-') ? '-' : null);
    if (!separator) return null;
    
    const parts = str.split(separator);
    if (parts.length !== 3) return null;
    
    let d: number, m: number, y: number;
    
    // Check if it's YYYY-MM-DD (standard HTML date input format)
    if (parts[0].length === 4) {
      y = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
      d = parseInt(parts[2].split(' ')[0], 10); // Handle cases with time
    } else {
      const val1 = parseInt(parts[0], 10);
      const val2 = parseInt(parts[1], 10);
      const val3 = parseInt(parts[2].split(' ')[0], 10);
      
      // Auto-detect and swap if preferred language format is impossible
      if (val2 > 12) {
        // Must be MM/DD/YYYY (e.g. 06/15/2026)
        m = val1;
        d = val2;
        y = val3;
      } else if (val1 > 12) {
        // Must be DD/MM/YYYY (e.g. 15/06/2026)
        d = val1;
        m = val2;
        y = val3;
      } else {
        // Both are <= 12 (e.g. 04/06/2026)
        // Since database order dates use pt-BR formatting 'DD/MM/YYYY' for appointmentDate/pickupDate,
        // and standard HTML5 input date values use YYYY-MM-DD,
        // any date with "/" separator in this app is DD/MM/YYYY.
        if (separator === '/') {
          d = val1;
          m = val2;
          y = val3;
        } else if (lang === 'en') {
          m = val1;
          d = val2;
          y = val3;
        } else {
          d = val1;
          m = val2;
          y = val3;
        }
      }
    }
    
    if (isNaN(d) || isNaN(m) || isNaN(y) || m > 12 || d > 31) return null;
    
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.customerName.toLowerCase().includes(orderSearch.toLowerCase());
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    let matchesDate = true;
    if (startDate || endDate) {
      let orderDate = order.pickupDate ? parseDateString(order.pickupDate, order.orderLanguage || settings.language || 'pt') : null;
      if (!orderDate && order.createdAt?.toDate) { orderDate = order.createdAt.toDate(); orderDate.setHours(0, 0, 0, 0); }
      if (orderDate) {
        if (startDate) { const start = parseDateString(startDate, settings.language || 'pt'); if (start && orderDate < start) matchesDate = false; }
        if (endDate) { const end = parseDateString(endDate, settings.language || 'pt'); if (end && orderDate > end) matchesDate = false; }
      } else matchesDate = false;
    }
    const matchesDept = orderDeptFilter === 'all' || order.items?.some(i => i.department === orderDeptFilter);
    const matchesPro = orderProfessionalFilter === 'all' || order.items?.some(i => i.professionalId === orderProfessionalFilter);
    return matchesSearch && matchesDate && matchesStatus && matchesDept && matchesPro;
  });

  const reminderOrders = useMemo(() => {
    if (!reminderMode) return [];
    
    // Determine the active department
    const activeDept = 
      deptLoggedIn.hair ? 'hair' : 
      deptLoggedIn.makeup ? 'makeup' : 
      deptLoggedIn.nails ? 'nails' : 
      deptLoggedIn.spa ? 'spa' :
      deptLoggedIn.clinic ? 'clinic' :
      deptLoggedIn.aesthetic ? 'aesthetic' : 
      null;
    
    const targetDate = new Date();
    if (reminderMode === '48h') targetDate.setDate(targetDate.getDate() + 2);
    if ((reminderMode as any) === 'custom') targetDate.setDate(targetDate.getDate() + 1); // Tomorrow for custom
    targetDate.setHours(0, 0, 0, 0);

    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth() + 1;
    const targetDay = targetDate.getDate();

    const isDateMatch = (dateStr: string | undefined, orderLang?: string) => {
      if (!dateStr) return false;
      const cleanStr = dateStr.trim();
      const separator = cleanStr.includes('/') ? '/' : (cleanStr.includes('-') ? '-' : null);
      if (!separator) return false;
      
      const parts = cleanStr.split(separator);
      if (parts.length !== 3) return false;
      
      let d = NaN, m = NaN, y = NaN;
      if (parts[0].length === 4) {
        y = parseInt(parts[0], 10);
        m = parseInt(parts[1], 10);
        d = parseInt(parts[2].split(' ')[0], 10);
      } else {
        const p0 = parseInt(parts[0], 10);
        const p1 = parseInt(parts[1], 10);
        const p2 = parseInt(parts[2].split(' ')[0], 10);
        y = p2;
        if (isNaN(y) || y < 1000) {
          if (p0 >= 1000) {
            y = p0; m = p1; d = p2;
          }
        } else {
          const isEnglish = (settings.language || 'pt') === 'en' || orderLang === 'en';
          if (isEnglish) {
            m = p0; d = p1;
          } else {
            d = p0; m = p1;
          }
          if (m > 12 && d <= 12) {
            const temp = m; m = d; d = temp;
          } else if (d > 31 && m <= 31) {
            const temp = m; m = d; d = temp;
          }
        }
      }
      return y === targetYear && m === targetMonth && d === targetDay;
    };

    return orders.filter(order => {
      // Filter by department if one is active
      const matchesDept = !activeDept || order.items?.some(i => i.department === activeDept);
      if (!matchesDept) return false;

      // Filter by professional if one is selected
      const matchesProf = orderProfessionalFilter === 'all' || order.items?.some(i => i.professionalId === orderProfessionalFilter);
      if (!matchesProf) return false;

      const topLevelMatch = isDateMatch(order.appointmentDate, order.orderLanguage);
      const itemsMatch = order.items?.some(item => isDateMatch(item.appointmentDate, order.orderLanguage));
      
      return topLevelMatch || itemsMatch;
    }).sort((a, b) => {
      const timeA = a.appointmentTime || '00:00';
      const timeB = b.appointmentTime || '00:00';
      return timeA.localeCompare(timeB);
    });
  }, [orders, reminderMode, settings.language, deptLoggedIn, orderProfessionalFilter]);

  const getReminderMessage = (order: Order, type: 'today' | '48h' | 'custom') => {
    const brand = settings.brandName || 'Easy Beauty';
    const services = order.items.map(i => `${i.title}${i.professionalName ? ` (${i.professionalName})` : ''}`).join(', ');
    const dateArr = order.items.map(i => i.appointmentDate || order.appointmentDate).filter(Boolean);
    const rawDate = dateArr.length > 0 ? dateArr[0] : (order.appointmentDate || order.pickupDate || '');
    const date = formatToMMDDYYYY(rawDate);
    const timeArr = order.items.map(i => formatTimeToAMPM(i.appointmentTime || order.appointmentTime || '')).filter(Boolean);
    const uniqueTimes = Array.from(new Set(timeArr));
    const time = uniqueTimes.length > 0 ? uniqueTimes.join(' / ') : formatTimeToAMPM(order.appointmentTime || '');
    
    const details = `Services: ${services}\nTime: ${time}`;

    const replaceTags = (text: string) => {
      return text
        .replace(/{nome}/g, order.customerName)
        .replace(/{marca}/g, brand)
        .replace(/{data}/g, date)
        .replace(/{detalhes}/g, details);
    };

    if (brand && order) {
      if (type === 'today') {
        const greeting = `Hello ${order.customerName}! 👋 This is ${brand}.\nJust confirming your appointment for today:\n\n📅 Appointment details:\n${details}`;
        const extraMessage = settings.reminderTemplateToday ? replaceTags(settings.reminderTemplateToday).trim() : '';
        return extraMessage 
          ? `${greeting}\n\n${extraMessage}` 
          : `${greeting}\n\nWe are looking forward to seeing you! ✨`;
      } else if (type === '48h') {
        const greeting = `Hello ${order.customerName}! 👋 This is ${brand}.\nJust reminding you of your scheduled appointment on ${date} at ${time}:\n\n📅 Appointment details:\n${details}`;
        const extraMessage = settings.reminderTemplate48h ? replaceTags(settings.reminderTemplate48h).trim() : '';
        return extraMessage 
          ? `${greeting}\n\n${extraMessage}` 
          : `${greeting}\n\nCould you please let us know if you can make it? ✨`;
      } else {
        const greeting = `Hello ${order.customerName}! 👋 This is ${brand}.`;
        const extraMessage = settings.customReminderMessage ? replaceTags(settings.customReminderMessage).trim() : '';
        return extraMessage
          ? `${greeting}\n\n${extraMessage}`
          : `${greeting}\n\nJust sending a message to keep in touch and check if you need any styling or assistance today! ✨`;
      }
    }

    let template = '';
    if (type === 'today') {
      template = settings.reminderTemplateToday || `Hello {nome}! 👋 Just checking in from {marca} to confirm your appointment for today:\n\n📅 Appointment details:\n{detalhes}\n\nWe are looking forward to seeing you. ✨`;
    } else if (type === '48h') {
      template = settings.reminderTemplate48h || `Hello {nome}! 👋 Hope you are having a wonderful week.\n\nThis is {marca} reminding you of your scheduled appointment in 2 days (on {data}):\n\n📅 Appointment details:\n{detalhes}\n\nCould you please let us know if you can make it? ✨`;
    } else {
      template = settings.customReminderMessage || `Hello {nome}! 👋 This is {marca}. Just sending a message to keep in touch and check if you need any styling or assistance today. ✨`;
    }
    return template;

    // Bypassed legacy templates below:
    let tempLegacy = '';
    if (type === 'today') {
      template = settings.reminderTemplateToday || `Olá {nome}! �� Passando da {marca} para confirmar seu horário de hoje:

�� Agendamento:
{detalhes}

We are waiting for you! See you soon. ✨`;
    } else if (type === '48h') {
      template = settings.reminderTemplate48h || `Olá {nome}! �� Everything okay? 

Passando da {marca} to remind you of your appointment daqui a 2 dias (dia {data}):

�� Agendamento:
{detalhes}

Can we confirm your visit? ✨`;
    } else {
      template = settings.customReminderMessage || `Hello {nome}! 👋 This is {marca}. Just sending a message to keep in touch and confirm if you need any assistance today. ✨`;
    }

    return template;
  };

  const batchSummary = useMemo(() => {
    const summary: { [key: string]: number } = {};
    const sidesSummary: { [key: string]: number } = {};
    filteredOrders.forEach(order => {
      order.items.forEach(item => {
        summary[item.title] = (summary[item.title] || 0) + item.quantity;
        if (item.mealOptions?.sides) item.mealOptions.sides.forEach(side => sidesSummary[side.name] = (sidesSummary[side.name] || 0) + item.quantity);
      });
    });
    return { items: summary, sides: sidesSummary };
  }, [filteredOrders]);

  const currencySymbol = settings?.currency === 'USD' ? '$' : 'R$';

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
    
    // If no preferred color, pick best one automatically based on background
    if (!preferredColor) {
      return bgBrightness > 128 ? '#000000' : '#ffffff';
    }

    // Otherwise, check if the preferred color has enough contrast
    const textBrightness = getBrightness(preferredColor);

    // If background is dark and text is also dark, force white
    if (bgBrightness <= 128 && textBrightness <= 128) {
      return '#ffffff';
    }
    
    // If background is light and text is also light, force black
    if (bgBrightness > 128 && textBrightness > 128) {
      return '#000000';
    }

    return preferredColor;
  };

  if (!isLoggedIn) {
    return (
      <div className="flex-grow flex items-center justify-center p-4" style={{ '--text-color': '#111827' } as React.CSSProperties}>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass p-8 rounded-3xl w-full max-w-md shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="h-32 w-32 flex items-center justify-center mb-4 rounded-full overflow-hidden border-2 border-white shadow-md bg-white">
              <img src={settings?.logo || DEFAULT_LOGO} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <h1 className="text-2xl font-serif font-bold opacity-90">Admin Panel - Easy Beauty</h1>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="password" placeholder="Access Password" className="w-full p-4 rounded-xl border border-gray-300 focus:ring-2 outline-none" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="submit" className="w-full py-4 rounded-xl font-bold text-lg shadow-lg" style={{ backgroundColor: settings?.primaryColor || '#865d39', color: getContrastColor(settings?.primaryColor || '#865d39') }}>Login</button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-grow flex flex-col md:flex-row w-full overflow-x-hidden" style={{ '--text-color': '#111827' } as React.CSSProperties}>
      <div className="w-full md:w-64 glass border-r border-white/20 p-4 md:p-6 flex flex-col gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 flex items-center justify-center rounded-full overflow-hidden border border-white/50 bg-white shadow-sm">
            <img src={settings?.logo || DEFAULT_LOGO} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <span className="font-serif font-bold text-lg opacity-90">{settings?.brandName || 'Easy Waxing'}</span>
        </div>
        <nav className="flex flex-col gap-2">
            {[
      { id: 'orders', label: t.nav.agenda, icon: Calendar },
      { id: 'finance', label: t.nav.finance, icon: DollarSign },
      { id: 'professionals', label: t.nav.professionals, icon: Users },
      { id: 'working-hours', label: t.nav.workingHours, icon: Clock },
      { id: 'categories', label: t.nav.categories, icon: Layers },
      { id: 'catalog', label: t.nav.services, icon: Package },
      { id: 'sides', label: t.nav.feedback, icon: History },
      { id: 'anamnese', label: t.nav.anamnese, icon: ClipboardList },
      { id: 'customers', label: t.nav.customers, icon: Users },
      { id: 'blacklist', label: t.nav.blacklist, icon: Lock },
      { id: 'waitlist', label: t.nav.waitlist, icon: UserPlus },
      { id: 'cancellation', label: t.nav.cancellation, icon: CalendarX },
      { id: 'holidays', icon: CalendarOff, label: t.nav.holidays },
      { id: 'seo', icon: SparklesAI, label: t.nav.seo },
      { id: 'settings', icon: SettingsIcon, label: t.nav.settings }
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={cn("flex items-center gap-3 p-3 rounded-xl transition-all", activeTab === tab.id ? "shadow-lg" : "hover:bg-white/30")} style={activeTab === tab.id ? { backgroundColor: settings?.primaryColor || '#865d39', color: getContrastColor(settings?.primaryColor || '#865d39') } : {}}>
                <tab.icon size={20} className="shrink-0" />
                <span className="truncate text-xs font-bold uppercase">{tab.label}</span>
              </button>
            ))}
        </nav>
        <button onClick={() => { setIsLoggedIn(false); setIsAdmin(false); window.history.pushState({}, '', '/'); }} className="mt-auto flex items-center gap-3 p-3 rounded-xl hover:bg-red-50 text-red-600 transition-all font-bold">
          <LogOut size={20} /> Logout
        </button>
      </div>

      <main className="flex-grow p-4 md:p-10 overflow-y-auto overflow-x-hidden min-w-0">
        {activeTab === 'professionals' && (
          <div className="space-y-8 pb-32">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-serif font-bold">Professionals</h2>
                <p className="text-sm opacity-60">Manage your team and their specialties.</p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-black uppercase opacity-40 ml-1">
                {profDeptFilter === 'all' 
                  ? 'General Order (Adjust priority by dragging professionals)' 
                  : `Organizing Order for: ${(settings as any)[`${profDeptFilter}Label`] || profDeptFilter}`}
              </label>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => setProfDeptFilter('all')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-[10px] font-black border transition-all shadow-sm",
                    profDeptFilter === 'all' ? "bg-black text-white border-black" : "bg-white/80 text-black border-gray-200"
                  )}
                >
                  ALL
                </button>
                {[
                  { id: 'hair', label: settings.hairLabel || 'Hair', active: settings.showHair !== false },
                  { id: 'makeup', label: settings.makeupLabel || 'Makeup', active: settings.showMakeup !== false },
                  { id: 'nails', label: settings.nailsLabel || 'Nails', active: settings.showNails !== false },
                  { id: 'spa', label: settings.spaLabel || 'Spa', active: settings.showSpa !== false },
                  { id: 'clinic', label: settings.clinicLabel || 'Clinic', active: settings.showClinic !== false },
                  { id: 'aesthetic', label: settings.aestheticLabel || 'Aesthetic', active: settings.showAesthetic !== false }
                ].filter(d => d.active).map(dept => (
                  <button 
                    key={dept.id}
                    onClick={() => setProfDeptFilter(dept.id as any)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-[10px] font-black border transition-all shadow-sm",
                      profDeptFilter === dept.id ? "bg-black text-white border-black" : "bg-white/80 text-black border-gray-200"
                    )}
                  >
                    {dept.label.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleAddProfessional} className="glass p-8 rounded-3xl space-y-6 shadow-xl border-white/40">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase opacity-40 ml-1">Professional Name</label>
                    <input 
                      type="text" 
                      className="w-full p-4 rounded-2xl border-white bg-white/50 focus:bg-white transition-all outline-none ring-primary/20 focus:ring-4" 
                      value={newProfessional.name} 
                      onChange={e => setNewProfessional({...newProfessional, name: e.target.value})} 
                      placeholder="Full name"
                      required
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-black uppercase opacity-40 ml-1 block">Specialties (Where she will appear)</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { id: 'hair', label: settings.hairLabel || 'Hair', active: settings.showHair !== false },
                        { id: 'makeup', label: settings.makeupLabel || 'Makeup', active: settings.showMakeup !== false },
                        { id: 'nails', label: settings.nailsLabel || 'Nails', active: settings.showNails !== false },
                        { id: 'spa', label: settings.spaLabel || 'Spa', active: settings.showSpa !== false },
                        { id: 'clinic', label: settings.clinicLabel || 'Clinic', active: settings.showClinic !== false },
                        { id: 'aesthetic', label: settings.aestheticLabel || 'Aesthetic', active: settings.showAesthetic !== false }
                      ].filter(dept => dept.active).map(dept => (
                        <button 
                          key={dept.id}
                          type="button"
                          onClick={() => {
                            const current = newProfessional.departments || [];
                            if (current.includes(dept.id as any)) {
                              setNewProfessional({...newProfessional, departments: current.filter(d => d !== dept.id)});
                            } else {
                              setNewProfessional({...newProfessional, departments: [...current, dept.id as any]});
                            }
                          }}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold border transition-all shadow-sm",
                            newProfessional.departments?.includes(dept.id as any) 
                              ? "bg-black text-white border-black scale-105" 
                              : "bg-white/80 text-black border-gray-200 hover:bg-white"
                          )}
                        >
                          {dept.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center gap-6">
                    <div className="w-28 h-28 rounded-full bg-white border-2 border-white overflow-hidden flex items-center justify-center shadow-lg shrink-0">
                      {newProfessional.avatar ? <img src={newProfessional.avatar} className="w-full h-full object-cover" /> : <Users className="text-gray-200" size={40} />}
                    </div>
                    <div className="flex flex-col gap-3">
                      <input type="file" id="prof-avatar" accept="image/*" onChange={e => handleFileChange(e, (b64) => setNewProfessional({...newProfessional, avatar: b64}), true)} className="hidden" />
                      <label htmlFor="prof-avatar" className="px-5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-black cursor-pointer hover:bg-gray-50 text-black shadow-sm transition-all active:scale-95 text-center">Choose Photo</label>
                      <p className="text-[10px] opacity-40 font-medium text-center">Recommended: 400x400px</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-black uppercase opacity-40 ml-1 block">Zelle QR (Individual)</label>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-xl bg-white border border-black/5 overflow-hidden flex items-center justify-center shadow-sm shrink-0">
                        {newProfessional.zelleQR ? (
                          <img src={newProfessional.zelleQR} alt="Individual Zelle QR" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="text-[10px] text-center opacity-30">No QR</div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <input type="file" id="prof-zelle" accept="image/*" onChange={e => handleFileChange(e, (b64) => setNewProfessional({...newProfessional, zelleQR: b64}))} className="hidden" />
                        <label htmlFor="prof-zelle" className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-[10px] font-black cursor-pointer hover:bg-gray-50 text-black shadow-sm transition-all active:scale-95">Select QR</label>
                        {newProfessional.zelleQR && (
                          <button type="button" onClick={() => setNewProfessional({...newProfessional, zelleQR: ''})} className="text-[10px] text-red-500 font-bold hover:underline text-left">Remove</button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase opacity-40 ml-1">Show in Application</label>
                    <div className="flex items-center gap-4">
                      <button 
                        type="button"
                        onClick={() => setNewProfessional({...newProfessional, isActive: !newProfessional.isActive})}
                        className={cn("px-6 py-3 rounded-xl text-xs font-black border transition-all shadow-sm", newProfessional.isActive ? "bg-green-50 text-green-600 border-green-200" : "bg-red-50 text-red-600 border-red-200")}
                      >
                        {newProfessional.isActive ? 'ACTIVE PROFESSIONAL' : 'INACTIVE PROFESSIONAL'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-6 border-t border-black/5">
                <button type="submit" className="flex-grow py-4 rounded-2xl font-black shadow-xl transition-all hover:scale-[1.01] active:scale-95" style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}>
                  {isEditingProfessional ? 'SAVE CHANGES' : 'REGISTER PROFESSIONAL'}
                </button>
                {isEditingProfessional && (
                  <button type="button" onClick={() => setIsEditingProfessional(null)} className="px-10 py-4 bg-white border border-gray-300 rounded-2xl font-bold hover:bg-gray-50 transition-all">CANCEL</button>
                )}
              </div>
            </form>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {professionals
                .filter(p => profDeptFilter === 'all' || p.departments.includes(profDeptFilter as any))
                .sort((a, b) => {
                  if (profDeptFilter === 'all') return a.order - b.order;
                  const orderA = a.deptOrder?.[profDeptFilter] ?? a.order ?? 0;
                  const orderB = b.deptOrder?.[profDeptFilter] ?? b.order ?? 0;
                  return orderA - orderB;
                })
                .map((prof, idx, filteredProfs) => (
                <div key={prof.id} className="glass p-6 rounded-3xl border border-white/50 flex flex-col gap-6 shadow-md hover:shadow-lg transition-all group">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-white border-2 border-white overflow-hidden shadow-md shrink-0">
                      <img src={prof.avatar || DEFAULT_LOGO} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-grow">
                      <h4 className="font-bold text-xl leading-tight">{prof.name}</h4>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {prof.departments.map(d => (
                          <span key={d} className="text-[9px] bg-black text-white px-2 py-0.5 rounded-full font-black uppercase opacity-70">
                            {(settings as any)[`${d}Label`] || d}
                            {profDeptFilter !== 'all' && prof.deptOrder?.[d] !== undefined && (
                              <span className="ml-1 opacity-50">#{prof.deptOrder[d]}</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className={cn("inline-block w-2 h-2 rounded-full", prof.isActive ? "bg-green-500" : "bg-red-500")}></span>
                        <span className="text-[10px] font-black uppercase opacity-40">{prof.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-black/5">
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => {
                          const prevIdx = idx - 1;
                          if (prevIdx >= 0) {
                            const prevProf = filteredProfs[prevIdx];
                            if (profDeptFilter === 'all') {
                              updateDoc(doc(db, 'profissionais', prof.id), { order: prevProf.order });
                              updateDoc(doc(db, 'profissionais', prevProf.id), { order: prof.order });
                            } else {
                              const dept = profDeptFilter;
                              const currentOrder = prof.deptOrder?.[dept] ?? prof.order ?? 0;
                              const prevOrder = prevProf.deptOrder?.[dept] ?? prevProf.order ?? 0;
                              updateDoc(doc(db, 'profissionais', prof.id), { [`deptOrder.${dept}`]: prevOrder });
                              updateDoc(doc(db, 'profissionais', prevProf.id), { [`deptOrder.${dept}`]: currentOrder });
                            }
                          }
                        }} 
                        disabled={idx === 0} 
                        className="p-2 rounded-xl border bg-white/50 hover:bg-black hover:text-white disabled:opacity-20 transition-all shadow-sm"
                        title="Move up"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button 
                         onClick={() => {
                          const nextIdx = idx + 1;
                          if (nextIdx < filteredProfs.length) {
                            const nextProf = filteredProfs[nextIdx];
                            if (profDeptFilter === 'all') {
                              updateDoc(doc(db, 'profissionais', prof.id), { order: nextProf.order });
                              updateDoc(doc(db, 'profissionais', nextProf.id), { order: prof.order });
                            } else {
                              const dept = profDeptFilter;
                              const currentOrder = prof.deptOrder?.[dept] ?? prof.order ?? 0;
                              const nextOrder = nextProf.deptOrder?.[dept] ?? nextProf.order ?? 0;
                              updateDoc(doc(db, 'profissionais', prof.id), { [`deptOrder.${dept}`]: nextOrder });
                              updateDoc(doc(db, 'profissionais', nextProf.id), { [`deptOrder.${dept}`]: currentOrder });
                            }
                          }
                        }} 
                        disabled={idx === filteredProfs.length - 1} 
                        className="p-2 rounded-xl border bg-white/50 hover:bg-black hover:text-white disabled:opacity-20 transition-all shadow-sm"
                        title="Move down"
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => { setIsEditingProfessional(prof); setNewProfessional(prof); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
                        className="p-2.5 text-blue-600 bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-100 transition-all"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => {
                          setConfirmModal({
                            isOpen: true,
                            title: settings.language === 'pt' ? 'Excluir Profissional' : 'Delete Professional',
                            message: settings.language === 'pt' 
                              ? `Tem certeza que deseja excluir permanentemente o(a) profissional ${prof.name}?` 
                              : `Are you sure you want to permanently delete the professional ${prof.name}?`,
                            onConfirm: async () => {
                              try {
                                await deleteDoc(doc(db, 'profissionais', prof.id));
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                toast.success(settings.language === 'pt' ? 'Profissional excluído com sucesso!' : 'Professional deleted successfully!');
                              } catch (err) {
                                toast.error('Error deleting professional.');
                              }
                            }
                          });
                        }} 
                        className="p-2.5 text-red-600 bg-red-50 border border-red-100 rounded-xl hover:bg-red-100 transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {professionals.length === 0 && (
                <div className="col-span-full py-20 text-center glass rounded-3xl border-2 border-dashed border-black/5 opacity-40">
                  No professionals registered.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'blacklist' && (
          <div className="space-y-8 pb-32">
            <div>
              <h2 className="text-3xl font-serif font-bold">Blacklist (Blocked Customers)</h2>
              <p className="text-sm opacity-60">Prevent specific customers from booking through WhatsApp or the form.</p>
            </div>

            <form onSubmit={handleAddBlacklist} className="glass p-8 rounded-3xl space-y-6 shadow-xl border-white/40">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase opacity-40 ml-1">Phone / WhatsApp (Ex: (999) 999-9999)</label>
                  <input 
                    type="text" 
                    className="w-full p-4 rounded-2xl border-white bg-white/50 focus:bg-white transition-all outline-none" 
                    placeholder="(999) 999-9999" 
                    value={newBlacklist.phone} 
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
                      setNewBlacklist({...newBlacklist, phone: formatted});
                    }} 
                    required 
                  />
                  <p className="text-[9px] opacity-40 px-1">The system will block any attempt with this exact number.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase opacity-40 ml-1">E-mail (Optional)</label>
                  <input 
                    type="email" 
                    className="w-full p-4 rounded-2xl border-white bg-white/50 focus:bg-white transition-all outline-none" 
                    placeholder="Primary e-mail" 
                    value={newBlacklist.email} 
                    onChange={e => setNewBlacklist({...newBlacklist, email: e.target.value})} 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase opacity-40 ml-1">Blocking Reason</label>
                <textarea 
                  className="w-full p-4 rounded-2xl border-white bg-white/50 focus:bg-white transition-all outline-none" 
                  rows={2} 
                  placeholder="Ex: Does not show up for appointments without notice..."
                  value={newBlacklist.reason} 
                  onChange={e => setNewBlacklist({...newBlacklist, reason: e.target.value})} 
                />
              </div>
              <button type="submit" className="w-full py-4 rounded-2xl font-black shadow-xl" style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}>
                {isEditingBlacklist ? <Save size={20} className="inline mr-2" /> : <Lock size={20} className="inline mr-2" />}
                {isEditingBlacklist ? 'SAVE CHANGES' : 'BLOCK CUSTOMER'}
              </button>
            </form>

            <div className="space-y-4">
              <h3 className="font-bold text-sm uppercase opacity-40 ml-2">Blocked List ({blacklist.length})</h3>
              {blacklist.map(record => (
                <div key={record.id} className="glass p-5 rounded-3xl flex items-center justify-between border-red-50 bg-red-50/20 hover:bg-red-50/30 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 shadow-sm border border-red-200/50">
                      <Lock size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg text-red-900 tracking-tight">{record.phone}</h4>
                      <div className="flex flex-wrap gap-3 text-xs">
                        {record.email && <span className="opacity-60">{record.email}</span>}
                        {record.email && record.reason && <span className="opacity-20">•</span>}
                        {record.reason && <span className="italic opacity-60 font-medium">"{record.reason}"</span>}
                      </div>
                      {((record as any).attemptedServices || (record as any).attemptedDate) && (
                        <div className="mt-2.5 p-3 rounded-2xl bg-white/60 border border-red-200/40 text-black space-y-1.5 max-w-lg shadow-sm">
                          <div className="text-[10px] font-black uppercase text-red-700 tracking-wider flex items-center gap-1.5">
                            <Sparkles size={11} className="animate-pulse" />
                            {settings.language === 'pt' ? 'Última Tentativa de Agendamento' : 'Last Booking Attempt'}
                          </div>
                          <div className="text-xs space-y-1">
                            { (record as any).attemptedServices && (
                              <p className="text-black/85">
                                <span className="font-bold">{settings.language === 'pt' ? 'Serviços: ' : 'Services: '}</span>
                                <span className="font-medium">{(record as any).attemptedServices}</span>
                              </p>
                            )}
                            { (record as any).attemptedDate && (
                              <p className="text-black/70 flex items-center gap-1">
                                <span className="font-bold">{settings.language === 'pt' ? 'Data/Hora: ' : 'Date/Time: '}</span>
                                <span className="font-mono bg-white/80 px-2 py-0.5 rounded-lg border border-black/5">{(record as any).attemptedDate}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => { 
                        setIsEditingBlacklist(record); 
                        setNewBlacklist(record); 
                        window.scrollTo({ top: 0, behavior: 'smooth' }); 
                      }} 
                      className="p-3 text-blue-600 bg-white border border-blue-100 rounded-xl hover:bg-blue-50 transition-all shadow-sm"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button 
                      onClick={() => {
                        setConfirmModal({
                          isOpen: true,
                          title: settings.language === 'pt' ? 'Desbloquear Cliente' : 'Unblock Customer',
                          message: settings.language === 'pt' 
                            ? `Deseja realmente remover ${record.phone} da blacklist e permitir agendamentos novamente?` 
                            : `Do you really want to remove ${record.phone} from the blacklist and allow bookings again?`,
                          onConfirm: async () => {
                            try {
                              await deleteDoc(doc(db, 'blacklist', record.id));
                              setConfirmModal(prev => ({ ...prev, isOpen: false }));
                              toast.success(settings.language === 'pt' ? 'Cliente desbloqueado com sucesso!' : 'Customer unblocked successfully!');
                            } catch (err) {
                              toast.error('Error unblocking customer.');
                            }
                          }
                        });
                      }} 
                      className="p-3 text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition-all shadow-sm"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
              {blacklist.length === 0 && (
                <div className="text-center py-20 opacity-30 italic">No blocked customers.</div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="max-w-3xl space-y-8 pb-10">
            <h2 className="text-3xl font-serif font-bold">Settings</h2>

            {/* QR Code & Sharing Section */}
            <div className="glass p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-4 max-w-md">
                <h3 className="text-xl font-serif font-bold flex items-center gap-2 text-black">
                  <Globe size={22} className="text-[#865d39]" />
                  Your Booking Link & QR Code
                </h3>
                <p className="text-sm opacity-70 leading-relaxed text-black/80">
                  Share this QR Code or booking link with your clients on social media, Instagram bio, WhatsApp, or print it out to display at your studio!
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 p-3 bg-white/40 border rounded-xl font-mono text-xs select-all break-all text-black">
                    {window.location.origin}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.origin);
                        toast.success('Booking link copied to clipboard!');
                      }}
                      className="px-4 py-2 bg-black text-white rounded-lg text-xs font-black uppercase tracking-wider hover:bg-black/80 transition-all flex items-center gap-2"
                    >
                      <Copy size={14} /> Copy Link
                    </button>
                    {qrCodeUrl && (
                      <button 
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = qrCodeUrl;
                          link.download = `${settings.brandName || 'EasyBeauty'}_booking_qrcode.png`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          toast.success('QR Code downloaded!');
                        }}
                        className="px-4 py-2 bg-white text-black border rounded-lg text-xs font-black uppercase tracking-wider hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <Printer size={14} /> Save/Print QR
                      </button>
                    )}
                  </div>
                </div>
              </div>
              
              {qrCodeUrl ? (
                <div className="flex flex-col items-center bg-white p-4 rounded-2xl border shadow-md shrink-0 border-black/5">
                  <img src={qrCodeUrl} alt="Booking QR Code" className="w-40 h-40 object-contain" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/40 mt-2">Scan to Book</span>
                </div>
              ) : (
                <div className="w-48 h-48 bg-white/40 border border-dashed rounded-2xl flex items-center justify-center text-xs opacity-40">
                  Generating QR Code...
                </div>
              )}
            </div>

            <div className="glass p-6 rounded-2xl space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">Logo</label>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-full bg-white p-1 border border-gray-200 flex items-center justify-center overflow-hidden shadow-sm">
                      <img src={settings?.logo} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input type="file" id="logo-upload" accept="image/*" onChange={e => handleFileChange(e, (b64) => setSettings({...settings, logo: b64}))} className="hidden" />
                        <label htmlFor="logo-upload" className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold cursor-pointer hover:bg-gray-50 text-black">Select Image</label>
                        <button 
                          onClick={() => setSettings({...settings, logo: DEFAULT_LOGO})}
                          className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold hover:bg-gray-50 text-black"
                        >
                          Reset to Default
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">Primary Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={settings?.primaryColor || '#865d39'} onChange={e => setSettings({...settings, primaryColor: e.target.value})} className="w-12 h-12 p-1 rounded-lg cursor-pointer border border-gray-200" />
                    <input type="text" className="flex-grow p-3 rounded-xl border border-gray-300 font-mono text-sm bg-white/50" value={settings?.primaryColor || ''} onChange={e => setSettings({...settings, primaryColor: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">Glass Background Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={settings?.glassColor || '#ffffff'} onChange={e => setSettings({...settings, glassColor: e.target.value})} className="w-12 h-12 p-1 rounded-lg cursor-pointer border border-gray-200" />
                    <input type="text" className="flex-grow p-3 rounded-xl border border-gray-300 font-mono text-sm bg-white/50" value={settings?.glassColor || ''} onChange={e => setSettings({...settings, glassColor: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">Text Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={settings?.textColor || '#000000'} onChange={e => setSettings({...settings, textColor: e.target.value})} className="w-12 h-12 p-1 rounded-lg cursor-pointer border border-gray-200" />
                    <input type="text" className="flex-grow p-3 rounded-xl border border-gray-300 font-mono text-sm bg-white/50" value={settings?.textColor || ''} onChange={e => setSettings({...settings, textColor: e.target.value})} />
                  </div>
                </div>
              </div>

              <div className="space-y-6 pt-6 border-t border-black/5">
                <div className="flex items-center gap-2 mb-2">
                  <Layers size={18} className="opacity-60" />
                  <h3 className="text-lg font-serif font-bold">Departments Personalization</h3>
                </div>
                <p className="text-xs opacity-50 -mt-4">Change names and icons on the client home screen.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[
                    { key: 'hair', defaultLabel: 'Hair', icon: Scissors },
                    { key: 'makeup', defaultLabel: 'Makeup', icon: Palette },
                    { key: 'nails', defaultLabel: 'Nails', icon: Sparkles },
                    { key: 'spa', defaultLabel: 'Spa', icon: Sparkles },
                    { key: 'clinic', defaultLabel: 'Clinic', icon: Sparkles },
                    { key: 'aesthetic', defaultLabel: 'Aesthetic', icon: Sparkles }
                  ].map(dept => (
                    <div key={dept.key} className="space-y-4 p-4 glass rounded-2xl border border-white text-black">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <dept.icon size={16} />
                          <span className="text-xs font-bold uppercase tracking-wider">{(settings as any)[`${dept.key}Label`] || dept.defaultLabel}</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={(settings as any)[`show${dept.key.charAt(0).toUpperCase() + dept.key.slice(1)}`] !== false}
                            onChange={e => setSettings({...settings, [`show${dept.key.charAt(0).toUpperCase() + dept.key.slice(1)}`]: e.target.checked})}
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold opacity-40 uppercase">Department Name</label>
                        <input 
                          type="text" 
                          className="w-full p-2 text-sm rounded-lg border border-gray-200" 
                          value={(settings as any)[`${dept.key}Label`] || dept.defaultLabel} 
                          onChange={e => setSettings({...settings, [`${dept.key}Label`]: e.target.value})} 
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold opacity-40 uppercase">Image/Icon</label>
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded border bg-white overflow-hidden flex items-center justify-center">
                            <img 
                              src={(settings as any)[`${dept.key}Icon`] || settings.logo} 
                              alt="Preview" 
                              className="w-full h-full object-cover" 
                              referrerPolicy="no-referrer"
                            />
                          </div>
                          <input type="file" id={`sett-${dept.key}-icon`} accept="image/*" className="hidden" onChange={e => handleFileChange(e, (b64) => setSettings({...settings, [`${dept.key}Icon`]: b64}))} />
                          <label htmlFor={`sett-${dept.key}-icon`} className="px-3 py-1 bg-white border rounded text-[10px] font-bold hover:bg-gray-50 cursor-pointer">Change</label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">Brand Name</label>
                  <textarea 
                    rows={2}
                    className="w-full p-3 rounded-xl border border-gray-300 resize-none" 
                    value={settings?.brandName || ''} 
                    onChange={e => handleBrandNameChange(e.target.value)} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">Slug (URL)</label>
                  <input type="text" className="w-full p-3 rounded-xl border border-gray-300" value={settings?.slug || ''} onChange={e => setSettings({...settings, slug: slugify(e.target.value)})} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2 col-span-1">
                  <label className="text-sm font-bold uppercase opacity-60">Country Code</label>
                  <select className="w-full p-3 rounded-xl border border-gray-300 bg-white" value={settings?.whatsappCountryCode || ''} onChange={e => {
                    const newDdi = e.target.value;
                    setSettings(prev => ({ ...prev, whatsappCountryCode: newDdi }));
                  }}>
                    <option value="+1">USA (+1)</option>
                    <option value="+55">BR (+55)</option>
                  </select>
                </div>
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-bold uppercase opacity-60">WhatsApp Number</label>
                  <input type="text" className="w-full p-3 rounded-xl border border-gray-300" value={settings?.whatsappNumber || ''} onChange={e => handleWhatsappChange(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-bold uppercase opacity-60">Slogan</label>
                <textarea rows={2} className="w-full p-3 rounded-xl border border-gray-300" value={settings?.slogan || ''} onChange={e => setSettings({...settings, slogan: e.target.value})} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold uppercase opacity-60">Welcome Pop-up Slogan</label>
                <textarea 
                  rows={2} 
                  className="w-full p-3 rounded-xl border border-gray-300" 
                  value={settings?.welcomeSlogan || ''} 
                  placeholder="Welcome to your moment of care. Choose how you want to start:"
                  onChange={e => setSettings({...settings, welcomeSlogan: e.target.value})} 
                />
              </div>

              <div className="space-y-4">
                <label className="text-sm font-bold uppercase opacity-60">Slogans per Department</label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { key: 'hair', label: settings.hairLabel || 'Hair' },
                    { key: 'makeup', label: settings.makeupLabel || 'Makeup' },
                    { key: 'nails', label: settings.nailsLabel || 'Nails' },
                    { key: 'spa', label: settings.spaLabel || 'Spa' },
                    { key: 'clinic', label: settings.clinicLabel || 'Clinic' },
                    { key: 'aesthetic', label: settings.aestheticLabel || 'Aesthetic' }
                  ].map(dept => (
                    <div key={dept.key} className="space-y-2">
                      <label className="text-[10px] font-bold opacity-40 uppercase">{dept.label}</label>
                      <textarea rows={2} className="w-full p-3 rounded-xl border border-gray-300 text-xs" value={(settings as any)[`${dept.key}Slogan`] || ''} onChange={e => setSettings({...settings, [`${dept.key}Slogan`]: e.target.value})} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">WhatsApp Message (Post Scheduling)</label>
                  <textarea rows={3} className="w-full p-3 rounded-xl border border-gray-300 text-sm" value={settings?.whatsappClosingMessage || ''} onChange={e => setSettings({...settings, whatsappClosingMessage: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase opacity-60">WhatsApp Message (Post Service)</label>
                  <textarea rows={3} className="w-full p-3 rounded-xl border border-gray-300 text-sm" value={settings?.whatsappPostAtendimentoMessage || ''} onChange={e => setSettings({...settings, whatsappPostAtendimentoMessage: e.target.value})} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-black/5">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase opacity-60">Info Block 1 (Checkout)</h3>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold opacity-40 uppercase">Title</label>
                    <input type="text" className="w-full p-3 rounded-xl border border-gray-300 text-sm" value={settings?.infoBlock1Title || ''} onChange={e => setSettings({...settings, infoBlock1Title: e.target.value})} placeholder="Ex: YOUR DATA IS SECURE" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold opacity-40 uppercase">Text</label>
                    <textarea rows={2} className="w-full p-3 rounded-xl border border-gray-300 text-sm" value={settings?.infoBlock1Text || ''} onChange={e => setSettings({...settings, infoBlock1Text: e.target.value})} placeholder="Ex: We use your information only for contact..." />
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase opacity-60">Info Block 2 (Checkout)</h3>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold opacity-40 uppercase">Title</label>
                    <input type="text" className="w-full p-3 rounded-xl border border-gray-300 text-sm" value={settings?.infoBlock2Title || ''} onChange={e => setSettings({...settings, infoBlock2Title: e.target.value})} placeholder="Ex: ALMOST THERE!" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold opacity-40 uppercase">Text</label>
                    <textarea rows={2} className="w-full p-3 rounded-xl border border-gray-300 text-sm" value={settings?.infoBlock2Text || ''} onChange={e => setSettings({...settings, infoBlock2Text: e.target.value})} placeholder="Ex: After filling out, our team will contact you..." />
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-black/5">
                <h3 className="text-lg font-serif font-bold">Reminder Templates</h3>
                <p className="text-[10px] opacity-60 font-medium">
                  Client greetings, branding, and details are automatically formatted and prepended in English. 
                  Write only the supplementary or custom closing message you wish to attach below.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase opacity-60">Today's Reminder</label>
                    <div className="p-2.5 bg-blue-50/50 rounded-xl text-[11px] opacity-75 font-mono text-blue-900 border border-blue-100">
                      <strong>Auto Preamble (English):</strong> Hello [Client]! 👋 This is [Salon]. Just confirming your appointment for today: Services & Time details...
                    </div>
                    <textarea 
                      rows={4} 
                      className="w-full p-3 rounded-xl border border-gray-300 text-sm" 
                      value={settings?.reminderTemplateToday || ''} 
                      placeholder="Type any additional text to accompany Today's Reminder at the end... (e.g. Please arrive 10 minutes prior!)"
                      onChange={e => setSettings({...settings, reminderTemplateToday: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase opacity-60">48h Reminder</label>
                    <div className="p-2.5 bg-blue-50/50 rounded-xl text-[11px] opacity-75 font-mono text-blue-900 border border-blue-100">
                      <strong>Auto Preamble (English):</strong> Hello [Client]! 👋 This is [Salon]. Just reminding you of your scheduled appointment on [Date] at [Time]...
                    </div>
                    <textarea 
                      rows={4} 
                      className="w-full p-3 rounded-xl border border-gray-300 text-sm" 
                      value={settings?.reminderTemplate48h || ''} 
                      placeholder="Type any additional text to accompany the 48h reminder... (e.g. Please let us know if you have any questions before then.)"
                      onChange={e => setSettings({...settings, reminderTemplate48h: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase opacity-60">Custom Reminder Template</label>
                    <textarea 
                      rows={5} 
                      className="w-full p-3 rounded-xl border border-gray-300 text-sm" 
                      value={settings?.customReminderMessage || ''} 
                      placeholder="Type the holiday / promotional message or discount coupon you wish to attach after the greeting..."
                      onChange={e => setSettings({...settings, customReminderMessage: e.target.value})} 
                    />
                  </div>
                </div>
              </div>

              {/* No-Show Settings Section */}
              <div className="bg-white/50 p-8 rounded-3xl space-y-6 border border-white">
                <div className="flex items-center gap-3 border-b border-black/5 pb-4">
                  <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                    <UserX size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-black">No-Show & Policy Settings</h3>
                    <p className="text-xs opacity-50 font-medium">Configure rules and message notifications for clients who fail to appear</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase opacity-45 ml-1 text-black">No-Show Fee ({currencySymbol})</label>
                    <input 
                      type="number" 
                      className="w-full p-4 rounded-2xl border border-gray-300 bg-white/70 text-black font-bold text-sm" 
                      value={settings.noShowFee === undefined ? '' : settings.noShowFee} 
                      onChange={e => setSettings({...settings, noShowFee: e.target.value === '' ? 0 : parseFloat(e.target.value)})} 
                      placeholder="Ex: 25.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase opacity-45 ml-1 text-black">Zelle / Transfer Details</label>
                    <input 
                      type="text" 
                      className="w-full p-4 rounded-2xl border border-gray-300 bg-white/70 text-black font-bold text-sm" 
                      value={settings.noShowPaymentInstructions || ''} 
                      onChange={e => setSettings({...settings, noShowPaymentInstructions: e.target.value})} 
                      placeholder="Ex: zelle@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase opacity-45 ml-1 text-black">No-Show Message Template</label>
                  <p className="text-[10px] opacity-60 font-semibold mb-1 text-black/70">
                    Variables available: <code className="bg-black/5 px-1 py-0.5 rounded text-black font-mono">{`{nome}`}</code> for customer name, <code className="bg-black/5 px-1 py-0.5 rounded text-black font-mono">{`{marca}`}</code> for business name, <code className="bg-black/5 px-1 py-0.5 rounded text-black font-mono">{`{fee}`}</code> for fee amount, and <code className="bg-black/5 px-1 py-0.5 rounded text-black font-mono">{`{payment_info}`}</code> for payment instructions.
                  </p>
                  <textarea 
                    rows={4}
                    className="w-full p-4 rounded-2xl border border-gray-300 bg-white/70 text-black text-sm" 
                    value={settings.noShowMessageTemplate || ''} 
                    onChange={e => setSettings({...settings, noShowMessageTemplate: e.target.value})} 
                    placeholder="Type the message to send to no-show clients..."
                  />
                </div>
              </div>

              {/* Custom Message Card Section */}
              <div className="bg-white/50 p-8 rounded-3xl space-y-6 border border-white">
                <div className="flex items-center gap-3 border-b border-black/5 pb-4">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <MessageSquare size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Custom Message Card</h3>
                    <p className="text-xs opacity-50 font-medium">Configure a special card on the Unified Agenda</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase opacity-40 ml-1">Card Title</label>
                    <input 
                      type="text" 
                      className="w-full p-4 rounded-2xl border-white bg-white/50 focus:bg-white transition-all outline-none" 
                      value={settings.customMessageCardTitle || ''} 
                      onChange={e => setSettings({...settings, customMessageCardTitle: e.target.value})} 
                      placeholder="Ex: Important Notice"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase opacity-40 ml-1">Button Link (Optional)</label>
                    <input 
                      type="text" 
                      className="w-full p-4 rounded-2xl border-white bg-white/50 focus:bg-white transition-all outline-none" 
                      value={settings.customMessageCardUrl || ''} 
                      onChange={e => setSettings({...settings, customMessageCardUrl: e.target.value})} 
                      placeholder="Ex: https://..."
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase opacity-40 ml-1">Card Message</label>
                  <textarea 
                    className="w-full p-4 rounded-2xl border-white bg-white/50 focus:bg-white transition-all outline-none min-h-[100px]" 
                    value={settings.customMessageCardText || ''} 
                    onChange={e => setSettings({...settings, customMessageCardText: e.target.value})} 
                    placeholder="Your custom message here..."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold uppercase opacity-60">Background Image</label>
                <div className="flex items-center gap-4">
                  {settings?.backgroundImage && (
                    <div className="w-20 h-12 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden shadow-sm">
                      <img src={settings?.backgroundImage} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <input type="file" id="bg-upload" accept="image/*" onChange={e => handleFileChange(e, (b64) => setSettings({...settings, backgroundImage: b64}))} className="hidden" />
                  <label htmlFor="bg-upload" className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-bold cursor-pointer hover:bg-gray-50 text-black">Select Image</label>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold uppercase opacity-60">Admin Password</label>
                <input type="text" className="w-full p-3 rounded-xl border border-gray-300" value={settings?.adminPassword || ''} onChange={e => setSettings({...settings, adminPassword: e.target.value})} />
              </div>

              {professionals.length > 0 && (
                <div className="glass rounded-3xl p-8 space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
                      <Users size={24} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-serif font-bold text-black">Professional Payment QR Codes</h3>
                      <p className="text-sm opacity-60">Configure up to 4 custom named payment QR codes for each professional.</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {professionals.map(prof => (
                      <div key={prof.id} className="p-6 rounded-3xl bg-white border border-black/5 flex flex-col gap-4 shadow-sm text-black">
                        <div className="flex items-center gap-4 border-b border-black/5 pb-3">
                          <div className="w-12 h-12 rounded-full overflow-hidden border border-black/10 shrink-0 bg-gray-100 shadow-sm">
                            <img src={prof.avatar || DEFAULT_LOGO} alt={prof.name} className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <h4 className="font-extrabold text-base text-black">{prof.name}</h4>
                            <p className="text-[10px] opacity-50 uppercase font-bold tracking-widest">Custom QR Codes (Max 4)</p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {[0, 1, 2, 3].map(idx => {
                            const qrs = prof.qrCodes || [];
                            const qrObj = qrs[idx] || { label: '', image: '' };
                            
                            return (
                              <div key={idx} className="p-3 bg-gray-50 rounded-2xl border border-black/5 flex items-center gap-3">
                                <div className="w-14 h-14 rounded-xl bg-white border border-black/10 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                                  {qrObj.image ? (
                                    <img src={qrObj.image} alt="QR Code" className="w-full h-full object-cover shadow-sm" />
                                  ) : (
                                    <div className="text-[8px] font-extrabold opacity-30 text-center uppercase">No QR</div>
                                  )}
                                </div>
                                
                                <div className="flex-grow min-w-0 flex flex-col gap-1.5">
                                  <input 
                                    type="text" 
                                    placeholder="Label (e.g. Zelle, Venmo)" 
                                    className="w-full px-2 py-1 rounded-lg border border-gray-300 text-[10px] font-bold text-black placeholder:font-normal bg-white"
                                    value={qrObj.label}
                                    onChange={async e => {
                                      const labelVal = e.target.value;
                                      const newQrs = [...qrs];
                                      while (newQrs.length <= idx) {
                                        newQrs.push({ label: '', image: '' });
                                      }
                                      newQrs[idx] = { ...newQrs[idx], label: labelVal };
                                      await updateDoc(doc(db, 'profissionais', prof.id), { qrCodes: newQrs });
                                    }}
                                  />
                                  
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input 
                                      type="file" 
                                      id={`qr-upload-${prof.id}-${idx}`} 
                                      accept="image/*" 
                                      className="hidden" 
                                      onChange={e => handleFileChange(e, async (b64) => {
                                        const newQrs = [...qrs];
                                        while (newQrs.length <= idx) {
                                          newQrs.push({ label: '', image: '' });
                                        }
                                        newQrs[idx] = { ...newQrs[idx], image: b64 };
                                        await updateDoc(doc(db, 'profissionais', prof.id), { qrCodes: newQrs });
                                      })}
                                    />
                                    <label 
                                      htmlFor={`qr-upload-${prof.id}-${idx}`} 
                                      className="px-2 py-0.5 bg-white border border-gray-300 rounded text-[9px] font-bold cursor-pointer hover:bg-gray-100 text-black shadow-sm"
                                    >
                                      {qrObj.image ? 'Change' : 'Select'}
                                    </label>
                                    {qrObj.image && (
                                      <button 
                                        type="button" 
                                        onClick={async () => {
                                          const newQrs = [...qrs];
                                          newQrs[idx] = { ...newQrs[idx], image: '' };
                                          await updateDoc(doc(db, 'profissionais', prof.id), { qrCodes: newQrs });
                                        }} 
                                        className="text-[9px] text-red-500 font-bold hover:underline"
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass rounded-3xl p-8 space-y-4">
                <h3 className="text-2xl font-serif font-bold text-black">Application Link</h3>
                <div className="flex items-center gap-4">
                  <div className="flex-grow bg-white/90 p-4 rounded-2xl font-mono text-sm break-all text-black border border-black/10 shadow-inner">
                    {`${window.location.origin}/?slug=${settings?.slug || 'easy-beauty'}`}
                  </div>
                  <button onClick={copyLink} className="font-bold text-sm hover:opacity-70 transition-all p-3 rounded-xl bg-white border border-black/10 shadow-sm" style={{ color: settings?.primaryColor || '#865d39' }}>{copied ? 'COPIED!' : 'COPY'}</button>
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <button onClick={saveSettings} disabled={isSaving} className="flex items-center gap-2 px-8 py-3 rounded-xl font-bold shadow-lg disabled:opacity-50" style={{ backgroundColor: settings?.primaryColor || '#865d39', color: getContrastColor(settings?.primaryColor || '#865d39') }}>
                  {isSaving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />} Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'waitlist' && (
          <div className="space-y-8 pb-32">
            <div>
              <h2 className="text-3xl font-serif font-bold">Waitlist</h2>
              <p className="text-sm opacity-60">Manage customers who joined the waitlist for appointments.</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-sm uppercase opacity-40 ml-2">Waitlist Records ({waitlist.length})</h3>
              </div>
              
              {waitlist.map(record => {
                const formattedDate = record.preferredDate ? new Date(record.preferredDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
                const cleanPhone = record.phone.replace(/\D/g, '');
                const countryCode = settings.whatsappCountryCode?.replace(/\D/g, '') || '1';
                const phoneWithCC = cleanPhone.startsWith(countryCode) ? cleanPhone : `${countryCode}${cleanPhone}`;
                
                // Pre-filled WhatsApp message for contact
                const serviceMessageSegment = record.service ? ` for ${record.service}` : ` in the ${record.department?.toUpperCase()} area`;
                const whatsappMessage = `Hi, ${record.name.split(' ')[0]}! ✨ This is the team from ${settings.brandName || 'Easy Beauty'}. We saw your interest on our waitlist${serviceMessageSegment} on ${record.preferredDate} during the ${record.preferredPeriod}. We have a slot available! Shall we book it?`;
                const whatsappUrl = `https://wa.me/${phoneWithCC}?text=${encodeURIComponent(whatsappMessage)}`;
                const smsUrl = `sms:${phoneWithCC}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodeURIComponent(whatsappMessage)}`;
                
                return (
                  <div key={record.id} className="glass p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-6 border-white bg-white/40 hover:bg-white/60 transition-all shadow-sm">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-12 h-12 rounded-2xl bg-black/5 flex items-center justify-center text-black/80 shadow-inner border border-black/5 flex-shrink-0">
                        <Users size={20} />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-bold text-lg text-black tracking-tight flex items-center gap-2">
                          {record.name}
                          <span className="px-2 py-0.5 bg-black/5 border border-black/10 rounded-full text-[9px] uppercase tracking-wider font-extrabold opacity-60">
                            {record.department}
                          </span>
                        </h4>
                        <div className="text-xs space-y-1 text-black/60 font-medium">
                          <p><span className="font-bold text-black/40 text-[10px]">PHONE:</span> {record.phone}</p>
                          <p><span className="font-bold text-black/40 text-[10px]">PREFERRED DATE:</span> {formattedDate} ({record.preferredDate})</p>
                          <p><span className="font-bold text-black/40 text-[10px]">PERIOD:</span> <span className="font-bold text-black">{record.preferredPeriod}</span></p>
                          {record.service && (
                            <p><span className="font-bold text-black/40 text-[10px]">SERVICE:</span> <span className="font-bold text-black">{record.service}</span></p>
                          )}
                          {record.notes && (
                            <p className="mt-2 italic bg-black/5 p-3 rounded-xl border border-black/5 text-[11px] text-black">
                              "{record.notes}"
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 self-end md:self-center">
                      <a 
                        href={whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2.5 text-xs bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition-[transform,background-color] active:scale-95 shadow-md flex items-center gap-2"
                      >
                        <MessageCircle size={14} fill="currentColor" /> CONTACT WHATSAPP
                      </a>
                      <a 
                        href={smsUrl}
                        className="px-4 py-2.5 text-xs bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-[transform,background-color] active:scale-95 shadow-md flex items-center gap-2"
                      >
                        <MessageSquare size={14} /> CONTACT SMS
                      </a>
                      <button 
                        onClick={() => {
                          setConfirmModal({
                            isOpen: true,
                            title: settings.language === 'pt' ? 'Excluir da Lista de Espera' : 'Delete from Waitlist',
                            message: settings.language === 'pt' 
                              ? `Deseja realmente remover ${record.name} da fila de espera?` 
                              : `Do you really want to remove ${record.name} from the waitlist?`,
                            onConfirm: async () => {
                              try {
                                await deleteDoc(doc(db, 'waitlist', record.id));
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                toast.success(settings.language === 'pt' ? 'Registro removido com sucesso!' : 'Waitlist item deleted successfully!');
                              } catch (err) {
                                toast.error('Error deleting waitlist item.');
                              }
                            }
                          });
                        }} 
                        className="p-2.5 text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition-all shadow-sm active:scale-95"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
              
              {waitlist.length === 0 && (
                <div className="text-center py-24 opacity-30 italic font-medium">No waitlist requests at the moment.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'cancellation' && (
          <div className="space-y-8 pb-32 text-black">
            <div>
              <h2 className="text-3xl font-serif font-bold">Cancellation & Reschedule Requests</h2>
              <p className="text-sm opacity-60">Manage customer requests for appointment cancellations or rescheduling.</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-sm uppercase opacity-40 ml-2">Requests ({cancellationRequests.length})</h3>
              </div>
              
              {cancellationRequests.map(record => {
                const formattedDate = record.date ? new Date(record.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
                const cleanPhone = record.phone.replace(/\D/g, '');
                const countryCode = settings?.whatsappCountryCode?.replace(/\D/g, '') || '1';
                const phoneWithCC = cleanPhone.startsWith(countryCode) ? cleanPhone : `${countryCode}${cleanPhone}`;
                
                const typeLabel = record.requestType === 'cancel' ? 'Cancellation' : 'Rescheduling';
                const isResolved = record.status === 'resolved';

                const whatsappMessage = `Hi, ${record.name.split(' ')[0]}! ✨ This is the team from ${settings?.brandName || 'Easy Beauty'}. We received your request to ${record.requestType === 'cancel' ? 'cancel' : 'reschedule'} your appointment on ${record.date} at ${record.time}. We can help you with that!`;
                const whatsappUrl = `https://wa.me/${phoneWithCC}?text=${encodeURIComponent(whatsappMessage)}`;
                const smsUrl = `sms:${phoneWithCC}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodeURIComponent(whatsappMessage)}`;
                
                return (
                  <div key={record.id} className={cn(
                    "glass p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-6 border transition-all shadow-sm",
                    isResolved 
                      ? "border-green-100 bg-green-50/10 opacity-70" 
                      : "border-white bg-white/40 hover:bg-white/60"
                  )}>
                    <div className="flex items-start gap-4 flex-1">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner border flex-shrink-0",
                        isResolved ? "bg-green-100 text-green-700 border-green-200" : "bg-black/5 text-black/80 border-black/5"
                      )}>
                        <CalendarX size={20} />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-bold text-lg text-black tracking-tight flex items-center gap-2 flex-wrap">
                          {record.name}
                          <span className={cn(
                            "px-2 py-0.5 border rounded-full text-[9px] uppercase tracking-wider font-extrabold",
                            record.requestType === 'cancel'
                              ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          )}>
                            {typeLabel}
                          </span>
                          {isResolved ? (
                            <span className="px-2 py-0.5 bg-green-100 border border-green-200 text-green-800 rounded-full text-[9px] uppercase tracking-wider font-extrabold flex items-center gap-1">
                              <CheckCircle2 size={10} /> Resolved
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-amber-100 border border-amber-200 text-amber-800 rounded-full text-[9px] uppercase tracking-wider font-extrabold">
                              Pending Action
                            </span>
                          )}
                        </h4>
                        <div className="text-xs space-y-1 text-black/60 font-medium">
                          <p><span className="font-bold text-black/40 text-[10px]">PHONE:</span> {record.phone}</p>
                          <p><span className="font-bold text-black/40 text-[10px]">APPOINTMENT DATE:</span> {formattedDate} ({record.date})</p>
                          <p><span className="font-bold text-black/40 text-[10px]">APPOINTMENT TIME:</span> <span className="font-bold text-black">{record.time}</span></p>
                          <p><span className="font-bold text-black/40 text-[10px]">PROFESSIONAL:</span> <span className="font-bold text-black">{record.professionalName || 'Any'}</span></p>
                          {record.notes && (
                            <p className="mt-2 italic bg-black/5 p-3 rounded-xl border border-black/5 text-[11px] text-black">
                              "{record.notes}"
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 self-end md:self-center">
                      {!isResolved && (
                        <button
                          onClick={async () => {
                            try {
                              await updateDoc(doc(db, 'cancellation_requests', record.id), { status: 'resolved' });
                              toast.success('Request marked as resolved!');
                            } catch (err) {
                              toast.error('Error resolving request.');
                            }
                          }}
                          className="px-4 py-2.5 text-xs bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition-[transform,background-color] active:scale-95 shadow-md flex items-center gap-1.5"
                        >
                          <CheckCircle2 size={14} /> MARK RESOLVED
                        </button>
                      )}
                      <a 
                        href={whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-4 py-2.5 text-xs bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition-[transform,background-color] active:scale-95 shadow-md flex items-center gap-1.5"
                      >
                        <MessageCircle size={14} fill="currentColor" /> CONTACT WHATSAPP
                      </a>
                      <a 
                        href={smsUrl}
                        className="px-4 py-2.5 text-xs bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-[transform,background-color] active:scale-95 shadow-md flex items-center gap-1.5"
                      >
                        <MessageSquare size={14} /> CONTACT SMS
                      </a>
                      <button 
                        onClick={() => {
                          setConfirmModal({
                            isOpen: true,
                            title: 'Delete Request',
                            message: `Do you really want to delete the request from ${record.name}?`,
                            onConfirm: async () => {
                              try {
                                await deleteDoc(doc(db, 'cancellation_requests', record.id));
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                toast.success('Request deleted successfully!');
                              } catch (err) {
                                toast.error('Error deleting request.');
                              }
                            }
                          });
                        }} 
                        className="p-2.5 text-red-600 bg-white border border-red-100 rounded-xl hover:bg-red-50 transition-all shadow-sm active:scale-95"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
              
              {cancellationRequests.length === 0 && (
                <div className="text-center py-24 opacity-30 italic font-medium">No cancellation or rescheduling requests at the moment.</div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'holidays' && (
          <div className="max-w-3xl space-y-8">
            <div>
              <h2 className="text-3xl font-serif font-bold">Holidays and Closures</h2>
              <p className="text-sm opacity-60">Specific dates when specific departments or the entire salon will be closed.</p>
            </div>
            
            <div className="glass p-6 rounded-2xl space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold opacity-60">Select Date</label>
                  <input 
                    type="date" 
                    className="w-full p-3 rounded-xl border border-gray-300" 
                    value={newHolidayDate} 
                    onChange={e => setNewHolidayDate(e.target.value)} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold opacity-60">Affected Departments</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'hair', label: settings.hairLabel || 'Hair', active: settings.showHair !== false },
                      { id: 'makeup', label: settings.makeupLabel || 'Makeup', active: settings.showMakeup !== false },
                      { id: 'nails', label: settings.nailsLabel || 'Nails', active: settings.showNails !== false },
                      { id: 'spa', label: settings.spaLabel || 'Spa', active: settings.showSpa !== false },
                      { id: 'clinic', label: settings.clinicLabel || 'Clinic', active: settings.showClinic !== false },
                      { id: 'aesthetic', label: settings.aestheticLabel || 'Aesthetic', active: settings.showAesthetic !== false }
                    ].filter(d => d.id === 'all' || d.active).map(dept => (
                      <button 
                        key={dept.id}
                        onClick={() => {
                          if (dept.id === 'all') {
                            setNewHolidayDepts(['all']);
                          } else {
                            const newDepts = newHolidayDepts.filter(d => d !== 'all');
                            if (newDepts.includes(dept.id as any)) {
                              setNewHolidayDepts(newDepts.filter(d => d !== dept.id));
                            } else {
                              setNewHolidayDepts([...newDepts, dept.id as any]);
                            }
                          }
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                          newHolidayDepts.includes(dept.id as any) 
                            ? "bg-black text-white border-black" 
                            : "bg-white text-black border-gray-200"
                        )}
                      >
                        {dept.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button 
                onClick={async () => {
                  try {
                    if (!newHolidayDate || newHolidayDepts.length === 0) {
                      toast.error(settings.language === 'pt' ? 'Por favor preencha a data e selecione pelo menos um setor' : 'Please fill the date and select at least one department');
                      return;
                    }
                    const hObj: Holiday = { date: newHolidayDate, departments: newHolidayDepts };
                    const currentHolidays = settings.holidays || [];
                    await saveHolidaysToFirestore([...currentHolidays, hObj]);
                    
                    setNewHolidayDate('');
                    setNewHolidayDepts(['all']);
                    toast.success(settings.language === 'pt' ? 'Bloqueio adicionado e salvo com sucesso!' : 'Closure added and saved successfully!');
                  } catch (err: any) {
                    console.error(err);
                    toast.error(`${settings.language === 'pt' ? 'Erro ao salvar o bloqueio.' : 'Error saving the closure.'}${err?.message ? ` (${err.message})` : ''}`);
                  }
                }}
                className="w-full py-4 rounded-xl font-bold shadow-xl" 
                style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
              >
                Add Closure
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {settings.holidays?.map((h, idx) => {
                const isLegacy = typeof h === 'string';
                const date = isLegacy ? h : h.date;
                const depts = isLegacy ? ['all'] : h.departments;
                const deptLabels = { 
                  all: 'All', 
                  hair: settings.hairLabel || 'Hair', 
                  makeup: settings.makeupLabel || 'Makeup', 
                  nails: settings.nailsLabel || 'Nails',
                  spa: settings.spaLabel || 'Spa',
                  clinic: settings.clinicLabel || 'Clinic',
                  aesthetic: settings.aestheticLabel || 'Aesthetic'
                };

                const isTimeBlocked = !isLegacy && h.startTime && h.endTime;
                const blockProf = !isLegacy && h.professionalId 
                  ? professionals.find(p => p.id === h.professionalId)?.name 
                  : 'Whole Team';

                return (
                  <div key={idx} className="glass p-4 rounded-xl flex items-center justify-between border border-red-100 italic">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Calendar size={16} className="text-red-500" />
                        <span className="font-bold text-sm">
                          {new Date(date + 'T12:00:00').toLocaleDateString('en-US')}
                        </span>
                        {isTimeBlocked && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-black rounded-full uppercase">
                            {formatTimeToAMPM(h.startTime || '')} - {formatTimeToAMPM(h.endTime || '')}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 ml-7">
                        {isTimeBlocked && (
                          <span className="px-2 py-0.5 bg-black/5 text-black/60 text-[10px] font-bold rounded-full">
                            For: {blockProf}
                          </span>
                        )}
                        {depts.map(d => (
                          <span key={d} className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-full border border-red-100">
                            {deptLabels[d as keyof typeof deptLabels]}
                          </span>
                        ))}
                        {!isLegacy && h.notes && (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-100">
                            Note: {h.notes}
                          </span>
                        )}
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setConfirmModal({
                          isOpen: true,
                          title: settings.language === 'pt' ? 'Excluir Bloqueio' : 'Delete Closure',
                          message: settings.language === 'pt' 
                            ? 'Tem certeza que deseja excluir permanentemente este bloqueio/horário fechado?' 
                            : 'Are you sure you want to permanently delete this closure/holiday?',
                          onConfirm: async () => {
                            try {
                              const newHolidays = settings.holidays?.filter((_, i) => i !== idx) || [];
                              await saveHolidaysToFirestore(newHolidays);
                              
                              setConfirmModal(prev => ({ ...prev, isOpen: false }));
                              toast.success(settings.language === 'pt' ? 'Bloqueio removido e salvo com sucesso!' : 'Closure removed and saved successfully!');
                            } catch (err: any) {
                              console.error(err);
                              toast.error(`${settings.language === 'pt' ? 'Erro ao salvar alterações.' : 'Error saving changes.'}${err?.message ? ` (${err.message})` : ''}`);
                            }
                          }
                        });
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title={settings.language === 'pt' ? 'Remover Bloqueio' : 'Remove Closure'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
              {(!settings.holidays || settings.holidays.length === 0) && (
                <div className="col-span-full py-10 text-center opacity-40 italic">
                  No manual closures added.
                </div>
              )}
            </div>
            
            <div className="pt-6">
              <button onClick={saveSettings} className="px-8 py-3 rounded-xl font-bold shadow-lg" style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}>
                Save Holiday Changes
              </button>
            </div>
          </div>
        )}

        {activeTab === 'seo' && (
          <div className="max-w-4xl space-y-8 pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-3xl font-serif font-bold flex items-center gap-2">
                  <SparklesAI className="text-pink-500" /> Assistente de SEO e Marketing IA
                </h2>
                <p className="text-sm opacity-60">Use Inteligência Artificial para atrair mais clientes através do Google.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <div className="space-y-6">
                <div className="glass p-6 rounded-3xl space-y-4 border-2" style={{ borderColor: settings.primaryColor + '20' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-2 rounded-lg bg-black text-white">
                      <Globe size={18} />
                    </div>
                    <h3 className="font-bold">What is your salon?</h3>
                  </div>
                  <p className="text-xs opacity-60 leading-relaxed">
                    Describe your business in detail. The more info you give (location, specialties, unique factors), the better the SEO report will be.
                  </p>
                  <textarea 
                    className="w-full p-4 rounded-xl border border-gray-200 bg-white/50 focus:bg-white transition-all outline-none min-h-[150px] text-sm"
                    placeholder="Ex: Beauty salon located in Miami, specialized in blonde highlights and laser hair removal. We have 10 years of experience and a luxurious environment..."
                    value={settings.businessDescription || ''}
                    onChange={(e) => setSettings({ ...settings, businessDescription: e.target.value })}
                  />
                  <button 
                    onClick={generateSEO}
                    disabled={isGeneratingSEO}
                    className="w-full py-4 rounded-xl text-white font-bold flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                    style={{ backgroundColor: settings.primaryColor }}
                  >
                    {isGeneratingSEO ? (
                      <>
                        <Loader2 className="animate-spin" size={18} />
                        Generating Smart Report...
                      </>
                    ) : (
                      <>
                        <SparklesAI size={18} />
                        Generate AI SEO Strategy
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
                {settings.seoHistory && settings.seoHistory.length > 0 ? (
                  settings.seoHistory.map((report, idx) => (
                    <motion.div 
                      key={report.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="glass p-8 rounded-3xl border border-white/40 shadow-xl overflow-hidden relative group"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="text-[10px] font-bold opacity-30 uppercase tracking-widest bg-black/5 px-2 py-1 rounded">
                          Generated on: {report.date}
                        </div>
                        <button 
                          onClick={() => deleteSEOReport(report.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Delete report"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      
                      <div className="markdown-body text-sm">
                        <ReactMarkdown>{report.analysis}</ReactMarkdown>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center border-2 border-dashed border-black/5 rounded-3xl text-center p-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                      <SparklesAI size={32} className="text-gray-300" />
                    </div>
                    <p className="text-sm font-bold opacity-40">No reports saved.</p>
                    <p className="text-[10px] opacity-30 mt-1">Fill in the description on the left and click generate.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'working-hours' && (
          <div className="space-y-8">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
              <div>
                <h2 className="text-3xl font-serif font-bold">Working Hours</h2>
                <p className="text-sm opacity-60">View and edit schedules for each professional.</p>
              </div>

              <div className="flex bg-white rounded-xl border p-1 overflow-x-auto gap-1 shadow-sm font-sans">
                <button 
                  onClick={() => {
                    setWorkingHoursProfessionalId('studio');
                    setEditingProfHoursId(null);
                    setIsEditingStudio(false);
                  }}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap",
                    workingHoursProfessionalId === 'studio' ? "bg-black text-white shadow-md" : "hover:bg-gray-100 text-black/60"
                  )}
                >
                  General Studio
                </button>
                {professionals.map(prof => (
                  <button 
                    key={prof.id} 
                    onClick={() => {
                      setWorkingHoursProfessionalId(prof.id);
                      setEditingProfHoursId(null);
                      setIsEditingStudio(false);
                    }}
                    className={cn(
                      "px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap",
                      workingHoursProfessionalId === prof.id ? "bg-black text-white shadow-md" : "hover:bg-gray-100 text-black/60"
                    )}
                  >
                    {prof.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-12 pb-32">
              {/* General Studio Working Hours */}
              {workingHoursProfessionalId === 'studio' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-1 bg-black rounded-full" />
                      <h3 className="font-serif font-bold text-xl uppercase tracking-wider">General Studio Working Hours</h3>
                    </div>
                    <button 
                      onClick={() => setIsEditingStudio(!isEditingStudio)}
                      className={cn(
                        "p-2 px-4 rounded-xl transition-all flex items-center gap-2 text-xs font-bold",
                        isEditingStudio ? "bg-green-100 text-green-700 ring-1 ring-green-200" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      )}
                    >
                      {isEditingStudio ? (
                        <><CheckCircle2 size={14} /> Finish Editing</>
                      ) : (
                        <><Edit2 size={14} /> Edit Studio Hours</>
                      )}
                    </button>
                  </div>
                  
                  <div className="glass p-8 rounded-3xl space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map(day => {
                        const dayLabels: { [key: string]: string } = {
                          monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
                          thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday'
                        };
                        const schedule = settings.hairWorkingHours?.[day] || { isOpen: true, start: '09:00', end: '18:00' };

                        return (
                          <div key={day} className={cn(
                            "p-4 rounded-2xl border transition-all",
                            schedule.isOpen ? "bg-white/40 border-white/50 shadow-sm" : "bg-red-50/20 border-red-100/30 opacity-60"
                          )}>
                            <div className="flex justify-between items-center mb-3">
                              <span className="font-bold text-xs uppercase opacity-60 tracking-widest">{dayLabels[day]}</span>
                              <button 
                                disabled={!isEditingStudio}
                                onClick={() => {
                                  const studioHours = { ...(settings.hairWorkingHours || {}) };
                                  (studioHours as any)[day] = { ...schedule, isOpen: !schedule.isOpen };
                                  setSettings({ 
                                    ...settings, 
                                    hairWorkingHours: studioHours as any,
                                    workingHours: studioHours as any
                                  });
                                }}
                                className={cn(
                                  "px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-tighter transition-all",
                                  schedule.isOpen ? "bg-green-500 text-white" : "bg-red-500 text-white",
                                  !isEditingStudio && "opacity-40"
                                )}
                              >
                                {schedule.isOpen ? 'Open' : 'Closed'}
                              </button>
                            </div>
                            {schedule.isOpen ? (
                              <div className="flex items-center gap-1">
                                {isEditingStudio ? (
                                  <>
                                    <input type="time" className="flex-1 p-1 bg-white rounded-lg border-none text-[11px] font-bold shadow-sm focus:ring-1 focus:ring-black outline-none" value={schedule.start} onChange={e => {
                                      const studioHours = { ...(settings.hairWorkingHours || {}) };
                                      (studioHours as any)[day] = { ...schedule, start: e.target.value };
                                      setSettings({ ...settings, hairWorkingHours: studioHours as any, workingHours: studioHours as any });
                                    }} />
                                    <span className="opacity-40 text-[9px]">to</span>
                                    <input type="time" className="flex-1 p-1 bg-white rounded-lg border-none text-[11px] font-bold shadow-sm focus:ring-1 focus:ring-black outline-none" value={schedule.end} onChange={e => {
                                      const studioHours = { ...(settings.hairWorkingHours || {}) };
                                      (studioHours as any)[day] = { ...schedule, end: e.target.value };
                                      setSettings({ ...settings, hairWorkingHours: studioHours as any, workingHours: studioHours as any });
                                    }} />
                                  </>
                                ) : (
                                  <div className="flex-1 text-center font-bold text-sm bg-white/30 rounded-lg py-1 border border-white/20">
                                    {formatTimeToAMPM(schedule.start)} — {formatTimeToAMPM(schedule.end)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center py-1 opacity-20"><Lock size={14} className="mx-auto" /></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {isEditingStudio && (
                      <button 
                        onClick={saveSettings} 
                        disabled={isSaving} 
                        className="px-8 py-3 rounded-xl text-white font-bold shadow-lg flex items-center gap-2 w-full justify-center" 
                        style={{ backgroundColor: settings.primaryColor }}
                      >
                        {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />} SAVE ALL STUDIO CHANGES
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Individual Professional Hours */}
              {workingHoursProfessionalId !== 'studio' && (
                <div className="space-y-8">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 bg-black rounded-full" />
                    <h3 className="font-serif font-bold text-xl uppercase tracking-wider">Individual Schedules</h3>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    {professionals
                      .filter(p => workingHoursProfessionalId === 'all' || p.id === workingHoursProfessionalId)
                      .map(prof => (
                        <div key={prof.id} className="glass p-6 rounded-3xl space-y-4 border border-white/50 shadow-md">
                          <div className="flex items-center justify-between border-b border-black/5 pb-4">
                            <div className="flex items-center gap-4">
                              <div className="h-12 w-12 rounded-full overflow-hidden border-2 border-white shadow-sm">
                                <img src={prof.avatar || DEFAULT_LOGO} className="w-full h-full object-cover" />
                              </div>
                              <div>
                                <h4 className="font-bold text-lg">{prof.name}</h4>
                                <p className="text-[10px] opacity-40 font-black uppercase">{prof.departments.join(' • ')}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  setOpeningSlotProfId(prof.id);
                                  setIsOpeningSlot(true);
                                }}
                                className="p-2 rounded-xl bg-black text-white hover:bg-black/90 transition-all text-xs font-bold flex items-center gap-2 shadow-sm"
                              >
                                <Calendar size={14} /> Open Slot
                              </button>
                              {editingProfHoursId === prof.id && (
                                <button 
                                  onClick={() => {
                                    setConfirmModal({
                                      isOpen: true,
                                      title: settings.language === 'pt' ? 'Copiar Horários' : 'Copy Hours',
                                      message: settings.language === 'pt'
                                        ? `Deseja realmente copiar todos os horários padrão do estúdio para ${prof.name}?`
                                        : `Do you really want to copy all studio hours to ${prof.name}?`,
                                      onConfirm: async () => {
                                        try {
                                          await updateDoc(doc(db, 'profissionais', prof.id), { 
                                            workingHours: settings.hairWorkingHours || {} 
                                          });
                                          setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                          toast.success(settings.language === 'pt' ? 'Horários copiados com sucesso!' : `Hours copied from studio!`);
                                        } catch (err) {
                                          toast.error('Error copying hours.');
                                        }
                                      }
                                    });
                                  }}
                                  className="p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all text-[10px] font-black uppercase flex items-center gap-1"
                                >
                                  <Copy size={12} /> Copy from Studio
                                </button>
                              )}
                              <button 
                                onClick={() => setEditingProfHoursId(editingProfHoursId === prof.id ? null : prof.id)}
                                className={cn(
                                  "p-2 rounded-xl transition-all flex items-center gap-2 text-xs font-bold",
                                  editingProfHoursId === prof.id ? "bg-green-100 text-green-700 ring-1 ring-green-200" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                )}
                              >
                                {editingProfHoursId === prof.id ? (
                                  <><Save size={14} /> Finish</>
                                ) : (
                                  <><Edit2 size={14} /> Edit Hours</>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Extra Slots List */}
                          {horariosExtras.filter(h => h.profId === prof.id).length > 0 && (
                            <div className="pt-2 space-y-2">
                              <h5 className="text-[10px] font-black uppercase opacity-60 flex items-center gap-2">
                                <Calendar size={10} /> Open Manual Slots
                              </h5>
                              <div className="flex flex-wrap gap-2">
                                {horariosExtras
                                  .filter(h => h.profId === prof.id)
                                  .map(h => (
                                    <div key={h.id} className="bg-black/5 rounded-lg px-3 py-1.5 flex items-center gap-3 border border-black/5">
                                      <div className="flex flex-col">
                                        <span className="text-[10px] font-bold">{h.date}</span>
                                        <span className="text-[9px] opacity-60 font-medium">{formatTimeToAMPM(h.start)} - {formatTimeToAMPM(h.end)}</span>
                                      </div>
                                      <button 
                                        onClick={() => {
                                          setConfirmModal({
                                            isOpen: true,
                                            title: settings.language === 'pt' ? 'Excluir Horário Manual' : 'Delete Manual Slot',
                                            message: settings.language === 'pt'
                                              ? `Deseja realmente excluir este horário extra (${h.date} ${formatTimeToAMPM(h.start)}-${formatTimeToAMPM(h.end)})?`
                                              : `Do you really want to delete this extra slot (${h.date} ${formatTimeToAMPM(h.start)}-${formatTimeToAMPM(h.end)})?`,
                                            onConfirm: async () => {
                                              try {
                                                await deleteDoc(doc(db, 'horarios_extras', h.id));
                                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                                toast.success(settings.language === 'pt' ? 'Horário excluído com sucesso!' : 'Slot deleted successfully!');
                                              } catch (err) {
                                                toast.error('Error deleting slot.');
                                              }
                                            }
                                          });
                                        }}
                                        className="text-red-500 hover:text-red-700 transition-colors"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  ))
                                }
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                            {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map(day => {
                              const dayShortLabels: { [key: string]: string } = {
                                monday: 'MON', tuesday: 'TUE', wednesday: 'WED',
                                thursday: 'THU', friday: 'FRI', saturday: 'SAT', sunday: 'SUN'
                              };
                              const schedule = prof.workingHours?.[day] || settings.hairWorkingHours?.[day] || { isOpen: true, start: '09:00', end: '18:00' };

                              return (
                                <div key={day} className={cn(
                                  "p-2 rounded-xl flex flex-col items-center gap-1 transition-all",
                                  schedule.isOpen ? "bg-white/60" : "bg-red-50/20 opacity-50"
                                )}>
                                  <button 
                                    disabled={editingProfHoursId !== prof.id}
                                    onClick={() => {
                                      const profHours = { ...(prof.workingHours || {}) };
                                      (profHours as any)[day] = { ...schedule, isOpen: !schedule.isOpen };
                                      updateDoc(doc(db, 'profissionais', prof.id), { workingHours: profHours });
                                    }}
                                    className={cn(
                                      "w-full text-center transition-all",
                                      editingProfHoursId === prof.id ? "cursor-pointer hover:scale-105" : "cursor-default"
                                    )}
                                  >
                                    <span className={cn(
                                      "text-[10px] font-black block mb-1",
                                      schedule.isOpen ? "text-gray-500" : "text-red-400"
                                    )}>{dayShortLabels[day]}</span>
                                    <div className={cn(
                                      "w-2 h-2 rounded-full mx-auto",
                                      schedule.isOpen ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500"
                                    )} />
                                  </button>
                                  
                                  {schedule.isOpen ? (
                                    <div className="flex flex-col gap-1 w-full mt-1">
                                      {editingProfHoursId === prof.id ? (
                                        <>
                                          <input 
                                            type="time" 
                                            className="w-full p-1 bg-white rounded-lg border border-gray-100 text-[10px] font-bold text-center shadow-sm focus:ring-1 focus:ring-black outline-none" 
                                            value={schedule.start} 
                                            onChange={e => {
                                              const profHours = { ...(prof.workingHours || {}) };
                                              (profHours as any)[day] = { ...schedule, start: e.target.value };
                                              updateDoc(doc(db, 'profissionais', prof.id), { workingHours: profHours });
                                            }} 
                                          />
                                          <input 
                                            type="time" 
                                            className="w-full p-1 bg-white rounded-lg border border-gray-100 text-[10px] font-bold text-center shadow-sm focus:ring-1 focus:ring-black outline-none" 
                                            value={schedule.end} 
                                            onChange={e => {
                                              const profHours = { ...(prof.workingHours || {}) };
                                              (profHours as any)[day] = { ...schedule, end: e.target.value };
                                              updateDoc(doc(db, 'profissionais', prof.id), { workingHours: profHours });
                                            }} 
                                          />
                                        </>
                                      ) : (
                                        <div className="text-[10px] font-black text-center text-black/60 bg-white/40 rounded-lg py-1 px-0.5 border border-white/50">
                                          {formatTimeToAMPM(schedule.start)}<br/><span className="text-[8px] opacity-30">to</span><br/>{formatTimeToAMPM(schedule.end)}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="h-10 flex items-center justify-center">
                                      <Lock size={12} className="opacity-20" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {editingProfHoursId === prof.id ? (
                            <div className="bg-green-50 p-2 rounded-xl border border-green-100 text-[9px] text-green-700 font-bold text-center uppercase tracking-tight flex items-center justify-center gap-2">
                              <CheckCircle2 size={12} /> Active Editing Mode - Changes saved instantly
                            </div>
                          ) : (
                            <div className="bg-gray-50 p-2 rounded-xl border border-gray-100 text-[9px] text-gray-500 font-bold text-center uppercase tracking-tight">
                              Select "Edit Hours" to make changes
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="space-y-8 pb-20">
            <div>
              <h2 className="text-3xl font-serif font-bold">Categories</h2>
              <p className="text-sm opacity-60">Organize your services into groups (e.g., Coloring, Cut, Manicure, etc).</p>
            </div>

            <div className="glass p-8 rounded-3xl space-y-6">
              <h3 className="text-xl font-serif font-bold flex items-center gap-2"><Layers size={20} /> Manage Categories</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <form onSubmit={handleAddCategory} className="flex flex-col gap-4 text-black">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input type="text" placeholder="Category Name" className="flex-grow p-3 rounded-xl border bg-white text-black" value={newCategory.title} onChange={e => setNewCategory({...newCategory, title: e.target.value})} />
                    <select 
                      className="p-3 rounded-xl border bg-white text-sm text-black" 
                      value={newCategory.department || ''} 
                      onChange={e => setNewCategory({...newCategory, department: e.target.value as any || undefined})}
                    >
                      <option value="">Section (Optional)</option>
                      {settings.showHair !== false && <option value="hair">{settings.hairLabel || 'Hair'}</option>}
                      {settings.showMakeup !== false && <option value="makeup">{settings.makeupLabel || 'Makeup'}</option>}
                      {settings.showNails !== false && <option value="nails">{settings.nailsLabel || 'Nails'}</option>}
                      {settings.showSpa !== false && <option value="spa">{settings.spaLabel || 'Spa'}</option>}
                      {settings.showClinic !== false && <option value="clinic">{settings.clinicLabel || 'Clinic'}</option>}
                      {settings.showAesthetic !== false && <option value="aesthetic">{settings.aestheticLabel || 'Aesthetic'}</option>}
                    </select>
                  </div>
                  <button type="submit" className="px-6 py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2" style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}>
                    {isEditingCategory ? <Save size={18} /> : <Plus size={18} />} {isEditingCategory ? 'Save' : 'Add Category'}
                  </button>
                </form>

                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {categories.map((cat, idx) => (
                    <div key={cat.id} className="bg-white/90 backdrop-blur-sm p-3 rounded-xl flex items-center justify-between border border-black/10 shadow-sm text-black">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <button onClick={() => moveCategory(cat.id, 'up')} disabled={idx === 0} className="p-1 disabled:opacity-20 hover:text-blue-500"><ArrowUp size={14} /></button>
                          <button onClick={() => moveCategory(cat.id, 'down')} disabled={idx === categories.length - 1} className="p-1 disabled:opacity-20 hover:text-blue-500"><ArrowDown size={14} /></button>
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-sm">{cat.title}</span>
                          <span className="text-[8px] opacity-40 uppercase font-black">{cat.department || 'General'}</span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setIsEditingCategory(cat); setNewCategory(cat); }} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={16} /></button>
                        <button onClick={() => deleteCategory(cat.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'catalog' && (
          <div className="space-y-12 pb-20">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
              <div>
                <h2 className="text-3xl font-serif font-bold">Service Catalog</h2>
                <p className="text-sm opacity-60">Manage all your procedures and categories in one place.</p>
              </div>
            </div>

            {/* Services Catalog */}
            <div className="space-y-8">
              <h3 className="text-xl font-serif font-bold flex items-center gap-2"><Package size={20} /> Services</h3>
              <form onSubmit={handleAddProduct} className="glass p-8 rounded-3xl space-y-6 text-black">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <input type="text" placeholder="Service Name" className="w-full p-3 rounded-xl border border-gray-300 text-black bg-white" value={newProduct.title} onChange={e => setNewProduct({...newProduct, title: e.target.value})} />
                    <textarea placeholder="Short description..." className="w-full p-3 rounded-xl border border-gray-300 text-black bg-white" rows={3} value={newProduct.description || ''} onChange={e => setNewProduct({...newProduct, description: e.target.value})} />
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <select 
                        className="w-full p-3 rounded-xl border border-gray-300 bg-white text-black" 
                        value={newProduct.department || ''} 
                        onChange={e => setNewProduct({...newProduct, department: e.target.value as any})}
                      >
                        <option value="">Menu Section...</option>
                        {settings.showHair !== false && <option value="hair">{settings.hairLabel || 'Hair'}</option>}
                        {settings.showMakeup !== false && <option value="makeup">{settings.makeupLabel || 'Makeup'}</option>}
                        {settings.showNails !== false && <option value="nails">{settings.nailsLabel || 'Nails'}</option>}
                        {settings.showSpa !== false && <option value="spa">{settings.spaLabel || 'Spa'}</option>}
                        {settings.showClinic !== false && <option value="clinic">{settings.clinicLabel || 'Clinic'}</option>}
                        {settings.showAesthetic !== false && <option value="aesthetic">{settings.aestheticLabel || 'Aesthetic'}</option>}
                      </select>
                      <select 
                        className="w-full p-3 rounded-xl border border-gray-300 bg-white text-black" 
                        value={newProduct.categoryId} 
                        onChange={e => setNewProduct({...newProduct, categoryId: e.target.value})}
                      >
                        <option value="">Category...</option>
                        {categories.filter(cat => !newProduct.department || cat.department === newProduct.department).map(cat => (
                          <option key={cat.id} value={cat.id} className="text-black">{cat.title}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold opacity-40 uppercase ml-2 text-black">Base Price</label>
                        <input 
                          type="text" 
                          placeholder="Price" 
                          className={cn("w-full p-3 rounded-xl border border-gray-300 text-black bg-white", newProduct.priceType === 'consult' && "opacity-50 pointer-events-none bg-gray-100")} 
                          value={priceInput} 
                          onChange={e => handlePriceChange(e.target.value)} 
                          disabled={newProduct.priceType === 'consult'}
                        />
                        <div className="flex gap-4 mt-2 px-2 text-black">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={newProduct.priceType === 'starting'} 
                              onChange={e => setNewProduct({...newProduct, priceType: e.target.checked ? 'starting' : 'fixed'})}
                            />
                            <span className="text-[10px] font-bold opacity-60 uppercase">Starting at</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={newProduct.priceType === 'consult'} 
                              onChange={e => {
                                const checked = e.target.checked;
                                setNewProduct({...newProduct, priceType: checked ? 'consult' : 'fixed'});
                                if (checked) setPriceInput('0');
                              }}
                            />
                            <span className="text-[10px] font-bold opacity-60 uppercase">Upon Consultation</span>
                          </label>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold opacity-40 uppercase ml-2 text-black">Estimated Duration</label>
                        <div className="flex items-center gap-2">
                          <div className="flex-grow flex items-center bg-white border border-gray-300 rounded-xl overflow-hidden px-3 text-black">
                            <input 
                              type="text" 
                              inputMode="numeric"
                              className="w-full p-3 border-none focus:ring-0 text-center text-black" 
                              value={durationHours} 
                              onChange={e => {
                                const val = e.target.value.replace(/\D/g, '');
                                setDurationHours(val);
                              }} 
                            />
                            <span className="text-[10px] font-bold opacity-40">H</span>
                          </div>
                          <div className="flex-grow flex items-center bg-white border border-gray-300 rounded-xl overflow-hidden px-3 text-black">
                            <input 
                              type="text" 
                              inputMode="numeric"
                              className="w-full p-3 border-none focus:ring-0 text-center text-black" 
                              value={durationMinutes} 
                              onChange={e => {
                                const val = e.target.value.replace(/\D/g, '');
                                if (val === '' || (parseInt(val) < 60)) {
                                  setDurationMinutes(val);
                                }
                              }} 
                            />
                            <span className="text-[10px] font-bold opacity-40">MIN</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <div className="w-32 h-32 rounded-2xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden shadow-inner shrink-0">
                        {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover" /> : <ImageIcon className="text-gray-200" size={48} />}
                      </div>
                      <div className="flex flex-col gap-2">
                        <input type="file" id="prod-img-catalog" accept="image/*" onChange={e => handleFileChange(e, (b64) => setNewProduct({...newProduct, image: b64}))} className="hidden" />
                        <label htmlFor="prod-img-catalog" className="px-6 py-3 bg-white border border-gray-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-gray-50 text-black text-center shadow-sm">Choose Image</label>
                        <p className="text-[9px] opacity-40 px-2 italic">Formats: JPG, PNG, WEBP</p>
                      </div>
                    </div>

                    <div className="space-y-4 pt-4 border-t border-black/5">
                      <h4 className="text-xs font-bold uppercase opacity-60 flex items-center gap-2 text-black">
                        <MessageSquare size={14} /> Automatic Instructions (WhatsApp)
                      </h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold opacity-40 uppercase ml-2 text-black">PRE-Service Instructions</label>
                          <textarea 
                            className="w-full p-3 rounded-xl border border-gray-300 text-xs min-h-[80px] text-black bg-white" 
                            placeholder="Ex: Please arrive with clean and dry hair..."
                            value={newProduct.preInstruction || ''}
                            onChange={e => setNewProduct({...newProduct, preInstruction: e.target.value})}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold opacity-40 uppercase ml-2 text-black">POST-Service Instructions</label>
                          <textarea 
                            className="w-full p-3 rounded-xl border border-gray-300 text-xs min-h-[80px] text-black bg-white" 
                            placeholder="Ex: Do not wash hair for the next 48 hours..."
                            value={newProduct.postInstruction || ''}
                            onChange={e => setNewProduct({...newProduct, postInstruction: e.target.value})}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold opacity-40 uppercase ml-2 text-black">Mandatory Anamnese Form</label>
                        <select 
                          className="w-full p-3 rounded-xl border border-gray-300 text-xs text-black bg-white"
                          value={newProduct.anamneseFormId || ''}
                          onChange={e => setNewProduct({...newProduct, anamneseFormId: e.target.value})}
                        >
                          <option value="">No form linked</option>
                          {anamneseForms.map(form => (
                            <option key={form.id} value={form.id} className="text-black">{form.title} ({form.department?.toUpperCase() || 'ALL'})</option>
                          ))}
                        </select>
                        <p className="text-[9px] opacity-40 italic px-2 text-black">If selected, the customer must fill out questions before booking.</p>
                      </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold opacity-40 uppercase ml-2 text-black">Maintenance Period (Days)</label>
                      <input 
                        type="number"
                        className="w-full p-3 rounded-xl border border-gray-300 text-xs text-black bg-white"
                        placeholder="Ex: 30"
                        value={newProduct.maintenanceDays || ''}
                        onChange={e => setNewProduct({...newProduct, maintenanceDays: parseInt(e.target.value) || 0})}
                      />
                      <p className="text-[9px] opacity-40 italic px-2 text-black">Defines after how many days the customer should return for this service (used for automatic reminders).</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold opacity-60 uppercase ml-2 text-black flex items-center gap-1">
                        Attending Professionals
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-white/40 rounded-xl border border-black/10">
                        {professionals.map(prof => {
                          const isChecked = (newProduct.allowedProfessionals || []).includes(prof.id);
                          return (
                            <label key={prof.id} className="flex items-center gap-3 text-xs font-semibold text-black cursor-pointer select-none py-1">
                              <input 
                                type="checkbox"
                                className="rounded text-black focus:ring-black w-4 h-4 border-gray-300 cursor-pointer"
                                checked={isChecked}
                                onChange={e => {
                                  const currentAllowed = newProduct.allowedProfessionals || [];
                                  if (e.target.checked) {
                                    setNewProduct({
                                      ...newProduct,
                                      allowedProfessionals: [...currentAllowed, prof.id]
                                    });
                                  } else {
                                    setNewProduct({
                                      ...newProduct,
                                      allowedProfessionals: currentAllowed.filter(id => id !== prof.id)
                                    });
                                  }
                                }}
                              />
                              <div className="w-7 h-7 rounded-full overflow-hidden border border-black/10 shrink-0 bg-gray-100">
                                <img src={prof.avatar || DEFAULT_LOGO} alt={prof.name} className="w-full h-full object-cover" />
                              </div>
                              <span className="truncate">{prof.name.split(' ')[0]}</span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-[9px] opacity-40 italic px-2 text-black">Choose which professionals can be scheduled for this service. If none are selected, all professionals in the department can perform it.</p>
                    </div>

                    <div className="flex items-center gap-3 p-4 bg-white/40 rounded-2xl border border-black/10">
                        <input 
                          type="checkbox" 
                          id="active-toggle"
                          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={newProduct.isActive !== false}
                          onChange={e => setNewProduct({...newProduct, isActive: e.target.checked})}
                        />
                        <label htmlFor="active-toggle" className="text-sm font-bold cursor-pointer text-black">Active Service (Visible to Customers)</label>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-4 pt-4">
                  <button type="submit" disabled={isSaving} className="flex-grow sm:flex-none px-12 py-4 rounded-xl font-bold shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2" style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}>
                    {isSaving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                    {isEditingProduct ? 'Save Changes' : 'Add to Catalog'}
                  </button>
                  {isEditingProduct && (
                    <button type="button" onClick={() => { setIsEditingProduct(null); resetProductForm(); }} className="px-8 py-4 rounded-xl bg-white border border-gray-300 font-bold hover:bg-gray-50 text-black">Cancel</button>
                  )}
                </div>
              </form>

              {/* Lista de Produtos Catalogo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 text-black">
                {products.map(product => (
                  <div key={product.id} className={cn("glass rounded-3xl overflow-hidden flex flex-col border transition-all hover:shadow-lg", product.isActive === false ? "opacity-50 grayscale" : "border-white/40 shadow-md")}>
                    <div className="h-56 relative group">
                      <img src={product.image || DEFAULT_LOGO} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                         <button onClick={() => { 
                          setIsEditingProduct(product); 
                          setNewProduct({...product}); 
                          setPriceInput(product.price ? product.price.toString() : ''); 
                          setDurationHours((Math.floor(product.duration / 60) || '').toString());
                          setDurationMinutes((product.duration % 60 || '').toString());
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }} className="p-3 bg-white rounded-full text-blue-600 shadow-xl hover:scale-110 transition-transform"><Edit2 size={20} /></button>
                        <button onClick={() => deleteProduct(product.id)} className="p-3 bg-white rounded-full text-red-600 shadow-xl hover:scale-110 transition-transform"><Trash2 size={20} /></button>
                      </div>
                      <div className="absolute top-4 left-4 flex gap-2">
                        <button onClick={() => toggleProductStatus(product)} className="p-2 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm text-black transition-all active:scale-90">
                          {product.isActive === false ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {product.duration > 0 && (
                        <div className="absolute bottom-4 right-4 bg-black/70 backdrop-blur-md text-white px-3 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1">
                          <Clock size={12} /> {Math.floor(product.duration / 60) > 0 ? `${Math.floor(product.duration / 60)}h ` : ''}{product.duration % 60} min
                        </div>
                      )}
                    </div>
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-lg leading-tight">{product.title}</h4>
                        <div className="flex gap-1">
                          <button 
                            onClick={() => { 
                              setIsEditingProduct(product); 
                              setNewProduct({...product}); 
                              setPriceInput(product.price ? product.price.toString() : ''); 
                              setDurationHours((Math.floor(product.duration / 60) || '').toString());
                              setDurationMinutes((product.duration % 60 || '').toString());
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }} 
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Edit"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={() => deleteProduct(product.id)} 
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs opacity-50 line-clamp-2 mb-4 h-8">{product.description}</p>
                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-black/5">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="text-xs opacity-40 font-bold uppercase tracking-widest">{categories.find(c => c.id === product.categoryId)?.title || 'No Category'}</span>
                            <span className="text-[8px] bg-black/5 px-2 py-1 rounded-full font-black uppercase opacity-60 text-black">{product.department}</span>
                          </div>
                          <span className="text-lg font-black" style={{ color: settings.primaryColor }}>
                            {product.priceType === 'consult' ? 'Upon Consultation' : 
                            `${product.priceType === 'starting' ? 'Starting at ' : ''}${currencySymbol} ${product.price.toFixed(2)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'sides' && (
          <div className="space-y-8 pb-20">
            <div>
              <h2 className="text-3xl font-serif font-bold">Returns Management</h2>
              <p className="text-sm opacity-60">Smart reminders based on the maintenance period of each service.</p>
            </div>

            <div className="glass p-8 rounded-3xl space-y-6">
              <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl flex items-center gap-3">
                <Sparkles className="text-blue-600" />
                <p className="text-xs text-blue-700">
                  The system identifies appointments made approximately 25-30 days ago (or as configured in the service) to suggest maintenance contact.
                </p>
              </div>

              {retornoItems.length === 0 ? (
                <div className="text-center py-20 bg-white/40 rounded-3xl border-2 border-dashed border-black/5">
                  <History size={40} className="mx-auto mb-4 opacity-20" />
                  <p className="opacity-40 italic">No suggested returns for today.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {retornoItems.map((item, idx) => (
                    <div key={idx} className="bg-white/60 p-4 rounded-2xl border border-white/50 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-white transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 bg-white rounded-2xl shadow-sm flex items-center justify-center font-bold text-lg" style={{ color: settings.primaryColor }}>
                          {item.customerName[0]}
                        </div>
                        <div>
                          <h4 className="font-bold">{item.customerName}</h4>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] opacity-60 font-bold uppercase tracking-wider">
                            <span className="text-black">{item.procedure}</span>
                            <span>•</span>
                            <span>Attended on: {item.lastDate.toLocaleDateString('en-US')} ({item.daysSince} days)</span>
                            <span>•</span>
                            <span className="text-red-500">Next Maintenance: {item.expiryDate.toLocaleDateString('en-US')}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2 w-full md:w-auto">
                        <button 
                          onClick={() => {
                            const whatsappNumber = item.phone.replace(/\D/g, '');
                            const countryCode = settings.whatsappCountryCode?.replace(/\D/g, '') || '1';
                            const message = `Hi, ${item.customerName.split(' ')[0]}! ✨\n\nThis is the team from ${settings.brandName || 'Easy Beauty'}. Just reminding you that your ${item.procedure} appointment was ${item.maintenanceDays} days ago on ${item.expiryDate.toLocaleDateString('en-US')}. Shall we schedule your return?`;
                            const url = `https://wa.me/${whatsappNumber.startsWith(countryCode) ? '' : countryCode}${whatsappNumber}?text=${encodeURIComponent(message)}`;
                            window.open(url, '_blank');
                          }}
                          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition-all shadow-md active:scale-95"
                          title="WhatsApp"
                        >
                          <MessageCircle size={18} fill="currentColor" /> WHATSAPP
                        </button>
                        <button 
                          onClick={() => {
                            const number = item.phone.replace(/\D/g, '');
                            const message = `Hi, ${item.customerName.split(' ')[0]}! From ${settings.brandName || 'Easy Beauty'}. Return for ${item.procedure} on ${item.expiryDate.toLocaleDateString('en-US')}. Shall we schedule?`;
                            const isIos = window.navigator.userAgent.match(/iPhone/i);
                            const url = `sms:${number}${isIos ? '&' : '?'}body=${encodeURIComponent(message)}`;
                            window.location.href = url;
                          }}
                          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition-all shadow-md active:scale-95"
                          title="SMS"
                        >
                          <MessageSquare size={18} /> SMS
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'anamnese' && (
          <div className="space-y-8 pb-20">
            <div>
              <h2 className="text-3xl font-serif font-bold">Anamnese Form Manager</h2>
              <p className="text-sm opacity-60">Create and manage technical questionnaires for your appointments.</p>
            </div>

            <div className="glass p-8 rounded-3xl space-y-6">
              <div className="flex flex-col gap-6">
                <div className="flex flex-col md:flex-row gap-4 items-end bg-black/5 p-6 rounded-2xl">
                  <div className="flex-grow space-y-1">
                    <label className="text-[10px] font-bold opacity-40 uppercase ml-2">Form Title</label>
                    <input 
                      type="text" 
                      placeholder="Ex: Technical Coloring Form" 
                      className="w-full p-3 rounded-xl border bg-white" 
                      value={newAnamneseForm.title || ''} 
                      onChange={e => setNewAnamneseForm({...newAnamneseForm, title: e.target.value})} 
                    />
                  </div>
                  <div className="w-full md:w-48 space-y-1">
                    <label className="text-[10px] font-bold opacity-40 uppercase ml-2">Department</label>
                    <select 
                      className="w-full p-3 rounded-xl border bg-white" 
                      value={newAnamneseForm.department || ''} 
                      onChange={e => {
                        const dept = e.target.value;
                        setNewAnamneseForm({
                          ...newAnamneseForm,
                          department: dept as any,
                          productId: '' // Reset product when department changes
                        });
                      }}
                    >
                      <option value="">ALL</option>
                      <option value="hair">{settings.hairLabel || 'HAIR'}</option>
                      <option value="makeup">{settings.makeupLabel || 'MAKEUP'}</option>
                      <option value="nails">{settings.nailsLabel || 'NAILS'}</option>
                      <option value="spa">{settings.spaLabel || 'SPA'}</option>
                      <option value="clinic">{settings.clinicLabel || 'CLINIC'}</option>
                      <option value="aesthetic">{settings.aestheticLabel || 'AESTHETIC'}</option>
                    </select>
                  </div>
                  <div className="w-full md:w-64 space-y-1">
                    <label className="text-[10px] font-bold opacity-40 uppercase ml-2">Service (Optional)</label>
                    <select 
                      className="w-full p-3 rounded-xl border bg-white" 
                      value={newAnamneseForm.productId || ''} 
                      onChange={e => setNewAnamneseForm({...newAnamneseForm, productId: e.target.value})}
                    >
                      <option value="">ALL SERVICES IN DEPARTMENT</option>
                      {products
                        .filter(p => !newAnamneseForm.department || p.department === newAnamneseForm.department)
                        .map(prod => (
                          <option key={prod.id} value={prod.id}>{prod.title}</option>
                        ))
                      }
                    </select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center px-2">
                    <h3 className="font-bold text-sm uppercase opacity-60">Form Questions</h3>
                    <button 
                      onClick={() => {
                        const q: AnamneseQuestion = { id: Date.now().toString(), label: '', type: 'text', required: true };
                        setNewAnamneseForm({
                          ...newAnamneseForm,
                          questions: [...(newAnamneseForm.questions || []), q]
                        });
                      }}
                      className="text-[10px] font-bold bg-black text-white px-3 py-1.5 rounded-lg flex items-center gap-1"
                    >
                      <Plus size={12} /> ADD QUESTION
                    </button>
                  </div>

                  <div className="space-y-3">
                    {newAnamneseForm.questions?.map((q, idx) => (
                      <div key={q.id} className="p-4 bg-white border rounded-2xl shadow-sm flex flex-col gap-3 relative">
                        <button 
                          onClick={() => {
                            setNewAnamneseForm({
                              ...newAnamneseForm,
                              questions: newAnamneseForm.questions?.filter((_, i) => i !== idx)
                            });
                          }}
                          className="absolute top-2 right-2 text-red-500 p-1"
                        >
                          <X size={16} />
                        </button>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                          <div className="md:col-span-7 space-y-1">
                            <label className="text-[9px] font-bold opacity-40 uppercase ml-2">Question Text</label>
                            <input 
                              type="text" 
                              className="w-full p-2 text-sm rounded-lg border bg-gray-50" 
                              placeholder="Ex: Have you ever had any allergies?" 
                              value={q.label}
                              onChange={e => {
                                const qs = [...(newAnamneseForm.questions || [])];
                                qs[idx].label = e.target.value;
                                setNewAnamneseForm({...newAnamneseForm, questions: qs});
                              }}
                            />
                          </div>
                          <div className="md:col-span-3 space-y-1">
                            <label className="text-[9px] font-bold opacity-40 uppercase ml-2">Answer Type</label>
                            <select 
                              className="w-full p-2 text-sm rounded-lg border bg-gray-50"
                              value={q.type}
                              onChange={e => {
                                const qs = [...(newAnamneseForm.questions || [])];
                                qs[idx].type = e.target.value as any;
                                if (qs[idx].type === 'choice' && !qs[idx].options) qs[idx].options = ['Yes', 'No'];
                                setNewAnamneseForm({...newAnamneseForm, questions: qs});
                              }}
                            >
                              <option value="text">Free Text</option>
                              <option value="choice">Multiple Choice</option>
                            </select>
                          </div>
                          <div className="md:col-span-2 flex items-center gap-2 pb-2">
                             <input 
                               type="checkbox" 
                               checked={q.required} 
                               onChange={e => {
                                 const qs = [...(newAnamneseForm.questions || [])];
                                 qs[idx].required = e.target.checked;
                                 setNewAnamneseForm({...newAnamneseForm, questions: qs});
                               }}
                             />
                             <span className="text-[10px] font-bold opacity-60 uppercase">Required</span>
                          </div>
                        </div>

                        {q.type === 'choice' && (
                          <div className="bg-black/5 p-3 rounded-xl space-y-2">
                            <label className="text-[9px] font-bold opacity-40 uppercase block">Options (separate with comma)</label>
                            <input 
                               type="text" 
                               className="w-full p-2 text-xs rounded-lg border bg-white" 
                               placeholder="Ex: Yes, No, Sometimes" 
                               value={q.options?.join(', ') || ''}
                               onChange={e => {
                                 const qs = [...(newAnamneseForm.questions || [])];
                                 qs[idx].options = e.target.value.split(',').map(s => s.trim());
                                 setNewAnamneseForm({...newAnamneseForm, questions: qs});
                               }}
                             />
                          </div>
                        )}
                      </div>
                    ))}
                    {(!newAnamneseForm.questions || newAnamneseForm.questions.length === 0) && (
                      <div className="py-8 text-center bg-white/50 border-2 border-dashed rounded-3xl opacity-40 text-xs">
                        Add questions by clicking the button above.
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t flex gap-3">
                  <button 
                    onClick={async () => {
                      if (!newAnamneseForm.title || !newAnamneseForm.questions?.length) {
                        toast.error('Fill in the title and add questions.');
                        return;
                      }
                      try {
                        if (isEditingAnamnese) {
                           await updateDoc(doc(db, 'anamnese_forms', isEditingAnamnese.id), newAnamneseForm);
                          setIsEditingAnamnese(null);
                          toast.success('Form updated!');
                        } else {
                          await addDoc(collection(db, 'anamnese_forms'), newAnamneseForm);
                          toast.success('Form created!');
                        }
                        setNewAnamneseForm({ title: '', questions: [] });
                      } catch (err) {
                        toast.error('Error saving form.');
                      }
                    }}
                    className="flex-grow py-4 rounded-xl font-bold shadow-lg"
                    style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                  >
                    {isEditingAnamnese ? 'SAVE CHANGES' : 'CREATE FORM'}
                  </button>
                  {isEditingAnamnese && (
                    <button 
                      onClick={() => { setIsEditingAnamnese(null); setNewAnamneseForm({ title: '', questions: [] }); }} 
                      className="px-8 py-4 bg-white border border-gray-300 rounded-xl font-bold"
                    >
                      CANCEL
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-8 border-t">
                {anamneseForms.map(form => (
                  <div key={form.id} className="p-5 glass rounded-2xl border border-white/50 shadow-sm flex flex-col gap-3 group hover:bg-white transition-all text-black">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-lg">{form.title}</h4>
                        <div className="flex flex-wrap gap-2">
                           <span className="text-[9px] bg-black/5 px-2 py-0.5 rounded-full font-black uppercase opacity-60">
                             {form.department || 'ALL DEPTS'}
                           </span>
                           {form.productId && (
                             <span className="text-[9px] bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full font-black uppercase">
                               Service: {products.find(p => p.id === form.productId)?.title || 'Selected Service'}
                             </span>
                           )}
                           <span className="text-[9px] bg-black/5 px-2 py-0.5 rounded-full font-black uppercase opacity-60">
                             {form.questions.length} QUESTIONS
                           </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => { setIsEditingAnamnese(form); setNewAnamneseForm(form); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => {
                            setConfirmModal({
                              isOpen: true,
                              title: 'Delete Anamnese Form',
                              message: `Do you want to permanently delete "${form.title}"?`,
                              onConfirm: async () => {
                                try {
                                  await deleteDoc(doc(db, 'anamnese_forms', form.id));
                                  toast.success('Form deleted.');
                                } catch (err) {
                                  toast.error('Error deleting form.');
                                }
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                              }
                            });
                          }} 
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {anamneseForms.length === 0 && (
                  <div className="col-span-full py-16 text-center opacity-30 italic">No forms created.</div>
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'customers' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-3xl font-serif font-bold">My Customers</h2>
              <button 
                onClick={() => setShowBirthdaysOnly(!showBirthdaysOnly)} 
                className={cn(
                  "px-4 py-2 rounded-xl font-bold text-sm w-full sm:w-auto flex items-center justify-center gap-2", 
                  showBirthdaysOnly ? "bg-pink-500 text-white" : "bg-white border text-black"
                )}
              >
                <Cake size={16} /> Birthdays
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-grow relative">
                <input 
                  type="text" 
                  placeholder="Search customer by name or phone..." 
                  className="w-full p-3 pl-10 rounded-xl border bg-white" 
                  value={customerSearch} 
                  onChange={e => setCustomerSearch(e.target.value)} 
                />
                <Users size={18} className="absolute left-3 top-3.5 opacity-30" />
              </div>
            </div>

            <div className="space-y-2">
              {uniqueCustomers.filter(c => {
                const matchesSearch = c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.phone && c.phone.includes(customerSearch));
                const matchesBirthday = showBirthdaysOnly ? isBirthdayThisWeek(c.birthday, c.orderLanguage) : true;
                return matchesSearch && matchesBirthday;
              }).map((customer, idx) => {
                const customerId = customer.phone || customer.email || customer.name;
                const isExpanded = expandedCustomers.includes(customerId);
                const waNumber = customer.phone.replace(/\D/g, '');
                
                return (
                  <div 
                    key={idx} 
                    className="glass rounded-2xl overflow-hidden border border-white/20 transition-all hover:bg-white/50 shadow-sm"
                  >
                    <div 
                      className="p-4 flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedCustomers(prev => isExpanded ? prev.filter(id => id !== customerId) : [...prev, customerId])}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center text-lg font-bold border border-black/5">
                          {customer.name.charAt(0)}
                        </div>
                        <div>
                          <h3 className="font-bold text-base">{customer.name}</h3>
                          <div className="flex items-center gap-2">
                            <p className="text-xs opacity-60">{customer.phone}</p>
                            <div className="flex gap-2">
                              <a 
                                href={`https://wa.me/${waNumber}`} 
                                target="_blank" 
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-green-600 hover:scale-110 transition-transform"
                                title="WhatsApp"
                              >
                                <MessageCircle size={14} fill="currentColor" className="text-white bg-green-500 rounded-full p-0.5" />
                              </a>
                              <a 
                                href={`sms:${waNumber}`} 
                                onClick={(e) => e.stopPropagation()}
                                className="text-blue-600 hover:scale-110 transition-transform"
                                title="SMS"
                              >
                                <MessageSquare size={14} className="text-blue-600" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="hidden sm:block text-[10px] bg-black/5 px-2 py-1 rounded-full font-bold opacity-60">
                          {customer.totalOrders} AGENDAMENTOS
                        </div>
                        {isExpanded ? <ChevronUp size={18} className="opacity-40" /> : <ChevronDown size={18} className="opacity-40" />}
                      </div>
                    </div>
                    
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }} 
                          animate={{ height: 'auto', opacity: 1 }} 
                          exit={{ height: 0, opacity: 0 }}
                          className="px-4 pb-4 border-t border-black/5 pt-4 space-y-4"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div className="space-y-1">
                              <p className="font-bold opacity-40 uppercase text-[10px]">E-mail</p>
                              <p>{customer.email || 'Not provided'}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="font-bold opacity-40 uppercase text-[10px]">Instagram</p>
                              <p>{customer.instagram ? `@${customer.instagram}` : 'Not provided'}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="font-bold opacity-40 uppercase text-[10px]">Birthday</p>
                              <p className="flex items-center gap-1 text-pink-600 font-bold">
                                <Cake size={12} /> {customer.birthday || 'Not provided'}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="font-bold opacity-40 uppercase text-[10px]">Address</p>
                              <p>{customer.address || 'Not provided'}</p>
                            </div>
                          </div>

                          <div className="space-y-3 pt-2">
                             <p className="font-bold opacity-40 uppercase text-[10px]">Appointment History</p>
                             <div className="space-y-2">
                               {orders
                                 .filter(o => (o.phone || o.email || o.customerName).toLowerCase() === (customer.phone || customer.email || customer.name).toLowerCase())
                                 .sort((a, b) => {
                                   const dateA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
                                   const dateB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
                                   return dateB - dateA;
                                 })
                                 .map(o => (
                                   <div key={o.id} className="bg-white/50 p-3 rounded-xl border border-black/5 text-[10px]">
                                     <div className="flex justify-between items-start mb-2">
                                       <span className="font-bold opacity-60 uppercase">{o.appointmentDate} at {formatTimeToAMPM(o.appointmentTime)}</span>
                                       <span className={cn("px-2 py-0.5 rounded-full font-bold", o.status === 'completed' ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700")}>
                                         {o.status === 'completed' ? 'COMPLETED' : 'PENDING'}
                                       </span>
                                     </div>
                                     <div className="space-y-1">
                                       {o.items.map((item, idx) => (
                                         <div key={idx} className="flex flex-wrap items-center gap-1">
                                           <span className="font-bold">{item.title}</span>
                                           {item.professionalName && (
                                             <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-black uppercase ring-1 ring-blue-100">
                                               Professional: {item.professionalName || professionals.find(p => p.id === item.professionalId)?.name}
                                             </span>
                                           )}
                                         </div>
                                       ))}
                                     </div>
                                   </div>
                                 ))}
                             </div>
                           </div>
                          
                          <div className="flex gap-2 justify-end pt-2">
                            <button 
                              onClick={() => { 
                                const record = customerRecords.find(r => r.phone === customer.phone);
                                setIsEditingCustomer(customer); 
                                setEditCustomerForm({...customer, notes: record?.notes || ''}); 
                              }} 
                              className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-blue-100 transition-colors"
                            >
                              <Edit2 size={14} /> EDIT
                            </button>
                            <button 
                              onClick={() => { setConfirmModal({ isOpen: true, title: 'Delete Customer', message: `Do you want to delete ${customer.name} and their history?`, onConfirm: () => deleteCustomer(customer) }); }} 
                              className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-[10px] font-bold flex items-center gap-2 hover:bg-red-100 transition-colors"
                            >
                              <Trash2 size={14} /> DELETE
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
              {uniqueCustomers.length === 0 && <p className="text-center opacity-40 italic py-10">No customers registered yet.</p>}
            </div>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-8">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
              <div className="space-y-1">
                <h2 className="text-3xl font-serif font-bold">Unified Agenda</h2>
                <p className="text-xs opacity-40 uppercase font-black tracking-widest">View and manage all appointments</p>
              </div>

              {settings.customMessageCardTitle && (
                <div className="glass p-6 rounded-3xl border border-white/40 shadow-xl flex flex-col md:flex-row items-center gap-6 relative overflow-hidden group">
                  <div className="absolute -top-10 -right-10 opacity-5 group-hover:rotate-12 transition-transform pointer-events-none">
                    <MessageSquare size={160} />
                  </div>
                  <div className="w-16 h-16 rounded-2xl bg-black/5 flex items-center justify-center shrink-0">
                    <Sparkles size={32} className="text-amber-500" />
                  </div>
                  <div className="flex-grow space-y-1 relative z-10">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-serif font-black">{settings.customMessageCardTitle}</h3>
                      <span className="px-2 py-0.5 bg-black/10 rounded-full text-[8px] font-black uppercase tracking-widest text-black/40">Custom Card</span>
                    </div>
                    <p className="text-xs font-medium opacity-60 leading-relaxed max-w-2xl whitespace-pre-wrap">{settings.customMessageCardText}</p>
                    {settings.customMessageCardUrl && (
                      <div className="pt-2">
                        <span className="text-[9px] font-bold opacity-30 uppercase block mb-1">Target Link:</span>
                        <code className="text-[10px] bg-black/5 px-2 py-1 rounded-lg">{settings.customMessageCardUrl}</code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-4 items-center">
                <button 
                  onClick={() => setIsManualBooking(true)}
                  className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-xl hover:scale-[1.02] active:scale-95 transition-all text-xs uppercase tracking-wider"
                  style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                >
                  <Plus size={18} /> Manual Booking
                </button>
                <button 
                  onClick={() => {
                    setBlockingProfId('all');
                    setBlockingDate('');
                    setBlockingStartTime('');
                    setBlockingEndTime('');
                    setBlockingNotes('');
                    setIsBlockingModalOpen(true);
                  }}
                  className="px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-xl hover:scale-[1.02] active:scale-95 transition-all text-xs uppercase tracking-wider bg-red-600 text-white hover:bg-red-700"
                >
                  <CalendarOff size={18} /> Block Period
                </button>
                <div className="flex bg-white rounded-xl border p-1 overflow-x-auto gap-1 shadow-sm font-sans">
                  <button 
                    onClick={() => setOrderProfessionalFilter('all')}
                    className={cn(
                      "px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap",
                      orderProfessionalFilter === 'all' ? "bg-black text-white shadow-md" : "hover:bg-gray-100 text-black/60"
                    )}
                  >
                    Whole Team
                  </button>
                  {professionals.map(prof => (
                    <button 
                      key={prof.id} 
                      onClick={() => setOrderProfessionalFilter(prof.id)}
                      className={cn(
                        "px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap",
                        orderProfessionalFilter === prof.id ? "bg-black text-white shadow-md" : "hover:bg-gray-100 text-black/60"
                      )}
                    >
                      {prof.name.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {!reminderMode && orderProfessionalFilter !== 'all' && (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/40 p-4 rounded-3xl border border-white/20 shadow-sm backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Selected Period</span>
                      <h3 className="text-xl font-serif font-bold">
                        {calendarWeek[0].toLocaleDateString('en-US' , { day: 'numeric', month: 'short' }) + ' - ' + calendarWeek[6].toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 bg-white/50 rounded-2xl p-1 border border-white/40">
                      <button onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() - 7); setCalendarDate(d); }} className="p-2 hover:bg-white rounded-xl transition-all"><ChevronLeft size={18} /></button>
                      <button onClick={() => setCalendarDate(new Date())} className="px-4 py-1.5 text-[10px] uppercase font-black hover:bg-white rounded-xl">Today</button>
                      <button onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() + 7); setCalendarDate(d); }} className="p-2 hover:bg-white rounded-xl transition-all"><ChevronRight size={18} /></button>
                    </div>
                  </div>
                </div>

                <div className="glass rounded-[2rem] border border-white/40 shadow-2xl overflow-hidden font-sans backdrop-blur-xl">
                  <div className="overflow-x-auto custom-scrollbar">
                    <div className="min-w-[950px] lg:min-w-0">
                      <div className="grid grid-cols-[80px_repeat(7,1fr)] bg-white/70 border-b border-black/5 divide-x divide-black/5">
                    <div className="p-4 flex items-center justify-center"><Clock size={16} className="opacity-20" /></div>
                    {calendarWeek.map((date, i) => (
                      <div key={i} className={cn("p-5 text-center transition-colors", date.toDateString() === new Date().toDateString() ? "bg-black/5" : "")}>
                        <span className="block text-[10px] font-black uppercase opacity-40 tracking-widest mb-1">{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                        <span className={cn("text-2xl font-serif font-bold transition-colors", date.toDateString() === new Date().toDateString() ? "text-slate-900" : "")} style={{ color: date.toDateString() === new Date().toDateString() ? "inherit" : (settings.primaryColor || '#865d39') }}>{date.getDate()}</span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-[80px_repeat(7,1fr)] max-h-[700px] overflow-y-auto custom-scrollbar relative divide-x divide-black/[0.03]">
                    {Array.from({ length: 35 }, (_, i) => {
                      const hour = Math.floor(i / 2) + 6;
                      const minutes = (i % 2) * 30;
                      const timeStr = `${hour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                      const ampm = hour >= 12 ? 'PM' : 'AM';
                      const displayHour = hour % 12 === 0 ? 12 : hour % 12;
                      const displayTimeStr = `${displayHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;

                      const nextSlotIndex = i + 1;
                      const nextHour = Math.floor(nextSlotIndex / 2) + 6;
                      const nextMinutes = (nextSlotIndex % 2) * 30;
                      const slotEndTimeStr = `${nextHour.toString().padStart(2, '0')}:${nextMinutes.toString().padStart(2, '0')}`;

                      return (
                        <React.Fragment key={timeStr}>
                          <div className="p-4 text-[10px] font-black text-right border-b border-black/[0.05] flex items-center justify-end bg-white/40" style={{ color: settings.primaryColor || '#865d39' }}>{displayTimeStr}</div>
                          {calendarWeek.map((date, dayIdx) => {
                            const year = date.getFullYear();
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            const isoDateStr = `${year}-${month}-${day}`;
                            const dateStr = date.toLocaleDateString('en-US');

                            const activeHolidays = (settings.holidays || []).filter((h: any) => {
                              if (typeof h === 'string') return false;
                              if (h.date !== isoDateStr) return false;
                              if (!h.startTime || !h.endTime) return false;

                              if (h.professionalId) {
                                if (orderProfessionalFilter !== 'all' && h.professionalId !== orderProfessionalFilter) return false;
                              } else {
                                if (orderProfessionalFilter !== 'all') {
                                  const selectedProf = professionals.find(p => p.id === orderProfessionalFilter);
                                  const isDeptMatch = h.departments.includes('all') || 
                                    (selectedProf?.departments && selectedProf.departments.some(d => h.departments.includes(d)));
                                  if (!isDeptMatch) return false;
                                } else {
                                  if (!h.departments.includes('all')) return false;
                                }
                              }

                              const bStart = h.startTime;
                              const bEnd = h.endTime;

                              return bStart < slotEndTimeStr && bEnd > timeStr;
                            });

                            const dayPositionedItems = getProfessionalDayLayout(
                              orders,
                              orderProfessionalFilter,
                              isoDateStr,
                              dateStr,
                              orderSearch
                            );

                            const isBlocked = activeHolidays.length > 0;
                            const blockLabel = (settings.language as string) === 'en' ? 'Blocked' : (settings.language as string) === 'es' ? 'Bloqueado' : 'Bloqueado';
                            
                            const startingBlocks = activeHolidays.filter((h: any) => {
                              const hStart = h.startTime; // e.g. "09:00"
                              const isSlotStart = hStart >= timeStr && hStart < slotEndTimeStr;
                              const isGridStart = timeStr === '06:00' && hStart < '06:00';
                              return isSlotStart || isGridStart;
                            });

                            const startingItems = dayPositionedItems.filter(p => {
                              const isSlotStart = p.timeStr >= timeStr && p.timeStr < slotEndTimeStr;
                              const isGridStart = timeStr === '06:00' && p.timeStr < '06:00';
                              return isSlotStart || isGridStart;
                            });

                            return (
                              <div key={`${dayIdx}-${timeStr}`} className={cn("border-b border-black/[0.05] min-h-[50px] relative transition-colors", isBlocked && startingItems.length === 0 ? "bg-red-500/[0.02]" : "")}>
                                {startingBlocks.map((block: any, blockIdx) => {
                                  const blockNotes = block.notes || block.title || '';
                                  const profName = block.professionalId 
                                    ? (professionals.find(p => p.id === block.professionalId)?.name || 'Professional')
                                    : (block.departments && block.departments.includes('all') 
                                        ? (settings.language === 'pt' ? 'Todos os Profissionais' : 'All Professionals') 
                                        : `${settings.language === 'pt' ? 'Depto: ' : 'Dept: '} ${block.departments?.join(', ')}`);
                                  
                                  const [sh, sm] = block.startTime.split(':').map(Number);
                                  const [eh, em] = block.endTime.split(':').map(Number);
                                  const startMinutesTotal = sh * 60 + sm;
                                  const endMinutesTotal = eh * 60 + em;
                                  const durationMin = Math.max(15, endMinutesTotal - startMinutesTotal);
                                  const cellStartMinutes = hour * 60 + minutes;
                                  
                                  const topOffsetPercent = Math.max(0, ((startMinutesTotal - cellStartMinutes) / 30) * 100);
                                  const heightRows = durationMin / 30;
                                  const cardHeightPercent = heightRows * 100;

                                  return (
                                    <div 
                                      key={block.id || blockIdx}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedBlockDetail({
                                          title: block.title || blockLabel,
                                          notes: blockNotes,
                                          startTime: block.startTime,
                                          endTime: block.endTime,
                                          profName: profName,
                                          originalBlock: block
                                        });
                                      }}
                                      className="absolute inset-x-0.5 rounded-xl bg-red-700 border-2 border-red-900 flex flex-col items-center justify-center text-center p-2 cursor-pointer hover:bg-red-800 transition-all shadow-md group/block z-10 overflow-hidden"
                                      style={{
                                        top: `calc(${topOffsetPercent}% + 2px)`,
                                        height: `calc(${cardHeightPercent}% - ${topOffsetPercent}% - 4px)`,
                                        boxShadow: '0 4px 15px rgba(185, 28, 28, 0.25)'
                                      }}
                                      title={block.notes || block.title || blockLabel}
                                    >
                                      <CalendarOff size={14} className="text-white mb-0.5 group-hover/block:scale-110 transition-transform shrink-0" />
                                      <span className="text-[10px] font-black tracking-wider text-white uppercase leading-tight shrink-0">{blockLabel}</span>
                                      <span className="text-[9px] font-bold text-red-100 font-mono leading-none mt-0.5 shrink-0">
                                        {block.startTime} - {block.endTime}
                                      </span>
                                      {(block.notes || block.title) && (
                                        <span className="text-[10px] font-extrabold text-red-950 mt-1 max-w-[95%] break-words line-clamp-3 px-2 py-0.5 bg-white/95 rounded border border-white/20 shadow-sm leading-tight">
                                          {block.notes || block.title}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                                {startingItems.map(positioned => {
                                  const cellStartMinutes = hour * 60 + minutes;
                                  const topOffsetPercent = Math.max(0, ((positioned.startMinutes - cellStartMinutes) / 30) * 100);
                                  const heightRows = positioned.duration / 30;
                                  const cardHeightPercent = heightRows * 100;

                                  return (
                                    <div 
                                      key={`${positioned.order.id}-${positioned.itemIndex}`} 
                                      onClick={() => setIsAttendingOrder(positioned.order)}
                                      className={cn(
                                        "absolute rounded-xl p-1.5 md:p-2 z-20 cursor-pointer shadow-md transition-all border block overflow-hidden group hover:z-30 hover:shadow-xl",
                                        positioned.order.status === 'completed' 
                                          ? "bg-gray-50 text-black/60 border-gray-200" 
                                          : "bg-white text-black border-gray-200 hover:border-gray-300"
                                      )}
                                      style={{ 
                                        top: `calc(${topOffsetPercent}% + 2px)`,
                                        height: `calc(${cardHeightPercent}% - ${topOffsetPercent}% - 4px)`,
                                        left: `calc(${positioned.colIndex * (100 / positioned.totalCols)}% + 2px)`,
                                        width: `calc(${100 / positioned.totalCols}% - 4px)`,
                                        borderLeft: `4px solid ${positioned.order.status === 'completed' ? '#000' : (settings.primaryColor || '#865d39')}`
                                      }}
                                    >
                                      <div className={cn(
                                        "text-[8px] font-black uppercase truncate mb-0.5",
                                        positioned.order.status === 'completed' ? "opacity-30" : "opacity-50"
                                      )}>{positioned.item.title}</div>
                                      <div className={cn(
                                        "text-[10px] font-bold leading-tight truncate",
                                        positioned.order.status === 'completed' ? "opacity-50" : "opacity-100"
                                      )}>{positioned.order.customerName}</div>
                                      {positioned.totalCols > 1 && (
                                        <div className="text-[8px] font-mono opacity-50 font-bold mt-0.5 truncate">
                                          {positioned.timeStr} ({positioned.duration}m)
                                        </div>
                                      )}
                                      {positioned.order.status === 'completed' && <CheckCircle2 size={12} className="absolute bottom-1 right-1 opacity-20" />}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

            {!reminderMode && orderProfessionalFilter === 'all' && (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/40 p-4 rounded-3xl border border-white/20 shadow-sm backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-40">
                        {settings.language === 'pt' ? 'Data Selecionada' : 'Selected Date'}
                      </span>
                      <h3 className="text-xl font-serif font-bold">
                        {calendarDate.toLocaleDateString(settings.language === 'pt' ? 'pt-BR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 bg-white/50 rounded-2xl p-1 border border-white/40">
                      <button onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() - 1); setCalendarDate(d); }} className="p-2 hover:bg-white rounded-xl transition-all"><ChevronLeft size={18} /></button>
                      <button onClick={() => setCalendarDate(new Date())} className="px-4 py-1.5 text-[10px] uppercase font-black hover:bg-white rounded-xl">Today</button>
                      <button onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() + 1); setCalendarDate(d); }} className="p-2 hover:bg-white rounded-xl transition-all"><ChevronRight size={18} /></button>
                    </div>
                  </div>
                </div>

                <div className="glass rounded-[2rem] border border-white/40 shadow-2xl overflow-hidden font-sans backdrop-blur-xl">
                  <div className="overflow-x-auto custom-scrollbar">
                    <div className="min-w-[950px] lg:min-w-0">
                      <div 
                        className="grid bg-white/70 border-b border-black/5 divide-x divide-black/5"
                        style={{ gridTemplateColumns: `80px repeat(${professionals.filter(p => p.isActive !== false).length}, minmax(180px, 1fr))` }}
                      >
                        <div className="p-4 flex items-center justify-center"><Clock size={16} className="opacity-20" /></div>
                        {professionals.filter(p => p.isActive !== false).map((prof) => (
                          <div key={prof.id} className="p-4 text-center flex flex-col items-center justify-center">
                            {prof.avatar ? (
                              <img 
                                src={prof.avatar} 
                                alt={prof.name} 
                                referrerPolicy="no-referrer"
                                className="w-12 h-12 rounded-full object-cover border-2 shadow-sm mb-1.5 mx-auto"
                                style={{ borderColor: settings.primaryColor || '#865d39' }}
                              />
                            ) : (
                              <div 
                                className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white mb-1.5 shadow-sm text-sm mx-auto"
                                style={{ backgroundColor: settings.primaryColor || '#865d39' }}
                              >
                                {prof.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                              </div>
                            )}
                            <span className="block text-xs font-black uppercase tracking-wider text-slate-800">{prof.name}</span>
                          </div>
                        ))}
                      </div>

                      <div 
                        className="grid max-h-[700px] overflow-y-auto custom-scrollbar relative divide-x divide-black/[0.03]"
                        style={{ gridTemplateColumns: `80px repeat(${professionals.filter(p => p.isActive !== false).length}, minmax(180px, 1fr))` }}
                      >
                        {Array.from({ length: 35 }, (_, i) => {
                          const hour = Math.floor(i / 2) + 6;
                          const minutes = (i % 2) * 30;
                          const timeStr = `${hour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                          const ampm = hour >= 12 ? 'PM' : 'AM';
                          const displayHour = hour % 12 === 0 ? 12 : hour % 12;
                          const displayTimeStr = `${displayHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;

                          const nextSlotIndex = i + 1;
                          const nextHour = Math.floor(nextSlotIndex / 2) + 6;
                          const nextMinutes = (nextSlotIndex % 2) * 30;
                          const slotEndTimeStr = `${nextHour.toString().padStart(2, '0')}:${nextMinutes.toString().padStart(2, '0')}`;

                          return (
                            <React.Fragment key={timeStr}>
                              <div className="p-4 text-[10px] font-black text-right border-b border-black/[0.05] flex items-center justify-end bg-white/40" style={{ color: settings.primaryColor || '#865d39' }}>{displayTimeStr}</div>
                              {professionals.filter(p => p.isActive !== false).map((prof) => {
                                const year = calendarDate.getFullYear();
                                const month = String(calendarDate.getMonth() + 1).padStart(2, '0');
                                const day = String(calendarDate.getDate()).padStart(2, '0');
                                const isoDateStr = `${year}-${month}-${day}`;
                                const dateStr = calendarDate.toLocaleDateString('en-US');

                                const activeHolidays = (settings.holidays || []).filter((h: any) => {
                                  if (typeof h === 'string') return false;
                                  if (h.date !== isoDateStr) return false;
                                  if (!h.startTime || !h.endTime) return false;

                                  if (h.professionalId) {
                                    if (h.professionalId !== prof.id) return false;
                                  } else {
                                    const isDeptMatch = h.departments.includes('all') || 
                                      (prof.departments && prof.departments.some((d: any) => h.departments.includes(d)));
                                    if (!isDeptMatch) return false;
                                  }

                                  const bStart = h.startTime;
                                  const bEnd = h.endTime;

                                  return bStart < slotEndTimeStr && bEnd > timeStr;
                                });

                                const dayPositionedItems = getProfessionalDayLayout(
                                  orders,
                                  prof.id,
                                  isoDateStr,
                                  dateStr,
                                  orderSearch
                                );

                                const isBlocked = activeHolidays.length > 0;
                                const blockLabel = (settings.language as string) === 'en' ? 'Blocked' : (settings.language as string) === 'es' ? 'Bloqueado' : 'Bloqueado';
                                
                                const startingBlocks = activeHolidays.filter((h: any) => {
                                  const hStart = h.startTime;
                                  const isSlotStart = hStart >= timeStr && hStart < slotEndTimeStr;
                                  const isGridStart = timeStr === '06:00' && hStart < '06:00';
                                  return isSlotStart || isGridStart;
                                });

                                const startingItems = dayPositionedItems.filter(p => {
                                  const isSlotStart = p.timeStr >= timeStr && p.timeStr < slotEndTimeStr;
                                  const isGridStart = timeStr === '06:00' && p.timeStr < '06:00';
                                  return isSlotStart || isGridStart;
                                });

                                return (
                                  <div key={`${prof.id}-${timeStr}`} className={cn("border-b border-black/[0.05] min-h-[50px] relative transition-colors", isBlocked && startingItems.length === 0 ? "bg-red-500/[0.02]" : "")}>
                                    {startingBlocks.map((block: any, blockIdx) => {
                                      const blockNotes = block.notes || block.title || '';
                                      const profName = block.professionalId 
                                        ? (professionals.find(p => p.id === block.professionalId)?.name || 'Professional')
                                        : (block.departments && block.departments.includes('all') 
                                            ? (settings.language === 'pt' ? 'Todos os Profissionais' : 'All Professionals') 
                                            : `${settings.language === 'pt' ? 'Depto: ' : 'Dept: '} ${block.departments?.join(', ')}`);
                                      
                                      const [sh, sm] = block.startTime.split(':').map(Number);
                                      const [eh, em] = block.endTime.split(':').map(Number);
                                      const startMinutesTotal = sh * 60 + sm;
                                      const endMinutesTotal = eh * 60 + em;
                                      const durationMin = Math.max(15, endMinutesTotal - startMinutesTotal);
                                      const cellStartMinutes = hour * 60 + minutes;
                                      
                                      const topOffsetPercent = Math.max(0, ((startMinutesTotal - cellStartMinutes) / 30) * 100);
                                      const heightRows = durationMin / 30;
                                      const cardHeightPercent = heightRows * 100;

                                      return (
                                        <div 
                                          key={block.id || blockIdx}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedBlockDetail({
                                              title: block.title || blockLabel,
                                              notes: blockNotes,
                                              startTime: block.startTime,
                                              endTime: block.endTime,
                                              profName: profName,
                                              originalBlock: block
                                            });
                                          }}
                                          className="absolute inset-x-0.5 rounded-xl bg-red-700 border-2 border-red-900 flex flex-col items-center justify-center text-center p-2 cursor-pointer hover:bg-red-800 transition-all shadow-md group/block z-10 overflow-hidden"
                                          style={{
                                            top: `calc(${topOffsetPercent}% + 2px)`,
                                            height: `calc(${cardHeightPercent}% - ${topOffsetPercent}% - 4px)`,
                                            boxShadow: '0 4px 15px rgba(185, 28, 28, 0.25)'
                                          }}
                                          title={block.notes || block.title || blockLabel}
                                        >
                                          <CalendarOff size={14} className="text-white mb-0.5 group-hover/block:scale-110 transition-transform shrink-0" />
                                          <span className="text-[10px] font-black tracking-wider text-white uppercase leading-tight shrink-0">{blockLabel}</span>
                                          <span className="text-[9px] font-bold text-red-100 font-mono leading-none mt-0.5 shrink-0">
                                            {block.startTime} - {block.endTime}
                                          </span>
                                          {(block.notes || block.title) && (
                                            <span className="text-[10px] font-extrabold text-red-950 mt-1 max-w-[95%] break-words line-clamp-3 px-2 py-0.5 bg-white/95 rounded border border-white/20 shadow-sm leading-tight">
                                              {block.notes || block.title}
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                    {startingItems.map(positioned => {
                                      const cellStartMinutes = hour * 60 + minutes;
                                      const topOffsetPercent = Math.max(0, ((positioned.startMinutes - cellStartMinutes) / 30) * 100);
                                      const heightRows = positioned.duration / 30;
                                      const cardHeightPercent = heightRows * 100;

                                      return (
                                        <div 
                                          key={`${positioned.order.id}-${positioned.itemIndex}`} 
                                          onClick={() => setIsAttendingOrder(positioned.order)}
                                          className={cn(
                                            "absolute rounded-xl p-1.5 md:p-2 z-20 cursor-pointer shadow-md transition-all border block overflow-hidden group hover:z-30 hover:shadow-xl",
                                            positioned.order.status === 'completed' 
                                              ? "bg-gray-50 text-black/60 border-gray-200" 
                                              : "bg-white text-black border-gray-200 hover:border-gray-300"
                                          )}
                                          style={{ 
                                            top: `calc(${topOffsetPercent}% + 2px)`,
                                            height: `calc(${cardHeightPercent}% - ${topOffsetPercent}% - 4px)`,
                                            left: `calc(${positioned.colIndex * (100 / positioned.totalCols)}% + 2px)`,
                                            width: `calc(${100 / positioned.totalCols}% - 4px)`,
                                            borderLeft: `4px solid ${positioned.order.status === 'completed' ? '#000' : (settings.primaryColor || '#865d39')}`
                                          }}
                                        >
                                          <div className={cn(
                                            "text-[8px] font-black uppercase truncate mb-0.5",
                                            positioned.order.status === 'completed' ? "opacity-30" : "opacity-50"
                                          )}>{positioned.item.title}</div>
                                          <div className={cn(
                                            "text-[10px] font-bold leading-tight truncate",
                                            positioned.order.status === 'completed' ? "opacity-50" : "opacity-100"
                                          )}>{positioned.order.customerName}</div>
                                          {positioned.totalCols > 1 && (
                                            <div className="text-[8px] font-mono opacity-50 font-bold mt-0.5 truncate">
                                              {positioned.timeStr} ({positioned.duration}m)
                                            </div>
                                          )}
                                          {positioned.order.status === 'completed' && <CheckCircle2 size={12} className="absolute bottom-1 right-1 opacity-20" />}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!reminderMode && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl">
                  <button 
                    onClick={() => setReminderMode('today')}
                    className="glass p-6 rounded-2xl flex items-center justify-between hover:scale-[1.02] transition-all border-l-4 group"
                    style={{ borderLeftColor: settings.primaryColor }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-4 rounded-2xl transition-colors bg-white/50 border shadow-sm group-hover:bg-white" style={{ color: settings.primaryColor }}>
                        <MessageCircle size={24} />
                      </div>
                      <div className="text-left">
                        <span className="font-bold block text-lg">Today's Reminders</span>
                        <span className="text-[10px] opacity-40 uppercase font-black tracking-widest text-black">Confirm clients for today</span>
                      </div>
                    </div>
                    <ChevronRight size={20} className="opacity-20 group-hover:opacity-40 transition-opacity" />
                  </button>

                  <button 
                    onClick={() => setReminderMode('48h')}
                    className="glass p-6 rounded-2xl flex items-center justify-between hover:scale-[1.02] transition-all border-l-4 group"
                    style={{ borderLeftColor: settings.primaryColor }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-4 rounded-2xl transition-colors bg-white/50 border shadow-sm group-hover:bg-white" style={{ color: settings.primaryColor }}>
                        <Clock size={24} />
                      </div>
                      <div className="text-left">
                        <span className="font-bold block text-lg">48h Reminders</span>
                        <span className="text-[10px] opacity-40 uppercase font-black tracking-widest text-black">Remind clients for after tomorrow</span>
                      </div>
                    </div>
                    <ChevronRight size={20} className="opacity-20 group-hover:opacity-40 transition-opacity" />
                  </button>

                  <button 
                    onClick={() => setReminderMode('custom')}
                    className="glass p-6 rounded-2xl flex items-center justify-between hover:scale-[1.02] transition-all border-l-4 group"
                    style={{ borderLeftColor: settings.primaryColor }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-4 rounded-2xl transition-colors bg-white/50 border shadow-sm group-hover:bg-white" style={{ color: settings.primaryColor }}>
                        <Sparkles size={24} />
                      </div>
                      <div className="text-left">
                        <span className="font-bold block text-lg">CUSTOM MESSAGE</span>
                        <span className="text-[10px] opacity-40 uppercase font-black tracking-widest text-black">Send your customized message</span>
                      </div>
                    </div>
                    <ChevronRight size={20} className="opacity-20 group-hover:opacity-40 transition-opacity" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-2">
                    <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center flex-grow">
                      {/* Status Filter Tabs */}
                      <div className="flex bg-white/60 p-1 rounded-xl border border-black/5 gap-1 self-start">
                        {(['pending', 'completed', 'no-show', 'all'] as const).map(status => (
                          <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all whitespace-nowrap",
                              statusFilter === status
                                ? "bg-black text-white shadow-sm"
                                : "hover:bg-black/5 text-black/60"
                            )}
                          >
                            {status === 'no-show' ? 'No-Shows' : status}
                          </button>
                        ))}
                      </div>

                      {/* Search Input */}
                      <div className="relative flex-grow max-w-md">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-35 text-black" size={16} />
                        <input 
                          type="text" 
                          placeholder={settings.language === 'pt' ? "Pesquisar cliente pelo nome..." : "Search client by name..."}
                          value={orderSearch} 
                          onChange={e => setOrderSearch(e.target.value)} 
                          className="w-full bg-white/60 border border-black/5 py-2 pl-10 pr-10 rounded-xl focus:outline-none focus:bg-white text-xs font-medium shadow-sm transition-all text-black"
                        />
                        {orderSearch && (
                          <button onClick={() => setOrderSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 text-[10px] font-bold text-black">CLEAR</button>
                        )}
                      </div>
                    </div>

                    {/* Department Filter (or visual legend) */}
                    <div className="flex gap-4 text-xs font-bold uppercase opacity-45 justify-end">
                      <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div> Pending</span>
                      <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-green-500"></div> Completed</span>
                      <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div> No-Show</span>
                    </div>
                  </div>
                  {filteredOrders.filter(o => 
                    orderDeptFilter === 'all' || 
                    o.items.some(i => i.department === orderDeptFilter)
                  ).map(order => (
                    <div key={order.id} className="bg-white/90 p-6 rounded-2xl space-y-4 border border-black/10 shadow-sm text-black">
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-serif font-bold text-lg text-black">{order.customerName}</span>
                            <span className={cn(
                              "text-[10px] uppercase px-2 py-0.5 rounded-full font-bold",
                              order.status === 'completed' ? "bg-green-100 text-green-700" : 
                              order.status === 'no-show' ? "bg-rose-100 text-rose-700" : "bg-orange-100 text-orange-700"
                            )}>
                              {order.status === 'completed' ? 'Completed' : 
                               order.status === 'no-show' ? 'No-Show' : 'Pending'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/60">
                            <span className="flex items-center gap-1 font-bold text-black"><Calendar size={12} /> {order.appointmentDate} at {formatTimeToAMPM(order.appointmentTime)}</span>
                            <span className="flex items-center gap-1"><MessageCircle size={12} /> {order.phone}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {order.status === 'pending' && (
                            <>
                              <button onClick={() => { setIsEditingOrder(null); setIsManualBooking(false); setIsAttendingOrder(order); setAttendingStep(1); }} className="p-2 bg-green-500 text-white rounded-xl hover:bg-green-600 shadow-md" title="Finalize Service (Complete)">
                                <CheckCircle2 size={18} />
                              </button>
                              <button 
                                onClick={() => { 
                                  setIsEditingOrder(null); 
                                  setIsManualBooking(false); 
                                  setIsAttendingOrder(order); 
                                  setAttendingStep(10); 
                                }} 
                                className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl shadow-sm border border-rose-100/30"
                                title="Client No-Show"
                              >
                                <UserX size={18} />
                              </button>
                              <button 
                                onClick={() => { 
                                  setIsEditingOrder(order); 
                                  setManualBookingData({...order}); 
                                  setManualBookingStep('services');
                                  setIsManualBooking(true);
                                }} 
                                className="p-2 bg-white/50 rounded-xl hover:bg-white text-blue-600 shadow-sm" 
                                title="Edit Booking"
                              >
                                <Edit2 size={18} />
                              </button>
                            </>
                          )}
                          <button onClick={() => toggleOrder(order.id)} className="p-2 bg-white/50 rounded-xl hover:bg-white transition-all">
                            {expandedOrders.includes(order.id) ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </button>
                          <button onClick={() => printOrder(order)} className="p-2 bg-white/50 rounded-xl hover:bg-white">
                            <Printer size={18} />
                          </button>
                          <button onClick={() => deleteOrder(order.id)} className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100">
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {expandedOrders.includes(order.id) && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden space-y-4"
                          >
                            <div className="border-t border-black/5 pt-4">
                              <h4 className="text-[10px] font-bold opacity-40 uppercase mb-2">Services and Professionals</h4>
                              <div className="space-y-2">
                                {order.items.map((item, idx) => (
                                  <div key={idx} className="flex justify-between items-center bg-white/30 p-3 rounded-xl border border-white/40">
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold">{item.title}</span>
                                        {item.professionalName && (
                                          <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-black uppercase">
                                            {item.professionalName}
                                          </span>
                                        )}
                                      </div>
                                      {(item.appointmentDate || item.appointmentTime) && (
                                        <span className="text-[10px] text-pink-600 font-bold block mt-1">
                                          📅 {item.appointmentDate} • ⏰ {formatTimeToAMPM(item.appointmentTime)}
                                        </span>
                                      )}
                                    </div>
                                    <span className="font-bold text-sm">{currencySymbol} {item.price.toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex justify-between items-center mt-4 pt-4 border-t border-black/5">
                                <span className="font-bold text-lg">Total</span>
                                <span className="font-serif font-bold text-xl">{currencySymbol} {order.total.toFixed(2)}</span>
                              </div>
                              {order.status === 'pending' && (
                                <div className="grid grid-cols-2 gap-2 pt-4">
                                  <button 
                                    onClick={() => {
                                      const text = encodeURIComponent(settings?.customReminderMessage || `Hello ${order.customerName}! This is ${settings.brandName}. We have an appointment for ${order.appointmentDate} at ${formatTimeToAMPM(order.appointmentTime)}.`);
                                      window.open(`https://wa.me/${order.phone.replace(/\D/g, '')}?text=${text}`, '_blank');
                                    }}
                                    className="px-3 py-2.5 rounded-xl bg-purple-600 text-white font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-purple-700 shadow-md transition-all text-center"
                                  >
                                    <MessageCircle size={12} fill="currentColor" /> CUSTOM (WA)
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const text = encodeURIComponent(settings?.customReminderMessage || `Hello ${order.customerName}! This is ${settings.brandName}. We have an appointment for ${order.appointmentDate} at ${formatTimeToAMPM(order.appointmentTime)}.`);
                                      const phone = order.phone.replace(/\D/g, '');
                                      window.open(`sms:${phone}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${text}`, '_blank');
                                    }}
                                    className="px-3 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-blue-700 shadow-md transition-all text-center"
                                  >
                                    <MessageSquare size={12} /> CUSTOM (SMS)
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const text = encodeURIComponent(`Hello ${order.customerName}! This is ${settings.brandName}. We have you scheduled for ${order.appointmentDate} at ${formatTimeToAMPM(order.appointmentTime)}. Can you confirm your attendance? ✨`);
                                      window.open(`https://wa.me/${order.phone.replace(/\D/g, '')}?text=${text}`, '_blank');
                                    }}
                                    className="px-3 py-2.5 rounded-xl bg-orange-500 text-white font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-orange-600 shadow-md transition-all text-center"
                                  >
                                    <MessageCircle size={12} fill="currentColor" /> CONFIRM (WA)
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const text = encodeURIComponent(`Hello ${order.customerName}! This is ${settings.brandName}. We have you scheduled for ${order.appointmentDate} at ${formatTimeToAMPM(order.appointmentTime)}. Can you confirm your attendance? ✨`);
                                      const phone = order.phone.replace(/\D/g, '');
                                      window.open(`sms:${phone}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${text}`, '_blank');
                                    }}
                                    className="px-3 py-2.5 rounded-xl bg-teal-600 text-white font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-teal-700 shadow-md transition-all text-center"
                                  >
                                    <MessageSquare size={12} /> CONFIRM (SMS)
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setIsEditingOrder(null); 
                                      setIsManualBooking(false); 
                                      setIsAttendingOrder(order); 
                                      setAttendingStep(10);
                                    }}
                                    className="col-span-2 mt-2 py-3 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/50 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-sm"
                                    title="Mark this client as no-show"
                                  >
                                    <UserX size={15} /> CLIENTE NO SHOW
                                  </button>
                                </div>
                              )}

                              {(order.status === 'completed' || order.status === 'no-show') && (
                                <div className="mt-4 pt-4 border-t border-black/5">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await updateDoc(doc(db, 'pedidos', order.id), {
                                          status: 'pending'
                                        });
                                        toast.success('Appointment reopened! You can now apply discounts and finalize.');
                                      } catch (err) {
                                        console.error("Error reopening appointment:", err);
                                        toast.error('Error reopening appointment.');
                                      }
                                    }}
                                    className="w-full py-3 rounded-xl text-white font-bold text-xs uppercase tracking-widest shadow-md transition-all flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98]"
                                    style={{ backgroundColor: settings.primaryColor || '#865d39' }}
                                  >
                                    <RotateCcw size={14} />
                                    REOPEN APPOINTMENT
                                  </button>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                  {filteredOrders.length === 0 && (
                    <div className="py-20 text-center opacity-40 italic">No bookings found.</div>
                  )}
                </div>
              </div>
            )}

            {reminderMode && (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white/40 p-4 rounded-2xl border border-white/20">
                  <h3 className="text-xl font-bold font-serif flex items-center gap-2">
                    {reminderMode === 'today' ? <MessageCircle size={20} className="text-blue-500" /> : reminderMode === '48h' ? <Calendar size={20} className="text-purple-500" /> : <Sparkles size={20} className="text-orange-500" />}
                    {reminderMode === 'today' ? "Today's Reminders" : reminderMode === '48h' ? "48h Reminders" : "CUSTOM MESSAGE"}
                  </h3>
                  <div className="flex items-center gap-2 flex-grow max-w-md mx-4">
                    <div className="relative w-full">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                      <input 
                        type="text" 
                        placeholder="Search for a client..." 
                        className="w-full pl-9 pr-4 py-2 rounded-xl border bg-white/50 text-xs font-bold outline-none focus:ring-2"
                        value={customerSearch}
                        onChange={e => setCustomerSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <button onClick={() => setReminderMode(null)} className="flex items-center gap-2 text-xs font-bold bg-white text-black px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition-all border shrink-0">
                    <ArrowLeft size={16} /> BACK
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {reminderMode === 'custom' ? (
                    customMessageClients.filter(c => {
                      const matchesSearch = c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.phone && c.phone.includes(customerSearch));
                      return matchesSearch;
                    }).map((customer, idx) => (
                      <div key={idx} className="glass p-6 rounded-3xl flex flex-col justify-between border-2 border-white/50 shadow-lg">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-black/5 flex items-center justify-center text-xl font-bold border border-black/5">
                              {customer.name.charAt(0)}
                            </div>
                            <div>
                              <h4 className="font-bold text-xl">{customer.name}</h4>
                              <p className="text-xs opacity-50 font-mono">{customer.phone}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <a 
                            href={`https://wa.me/${customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent((() => {
                              const brand = settings.brandName || 'Easy Beauty';
                              const greeting = `Hello ${customer.name}! 👋 This is ${brand}.`;
                              const extraMessage = settings.customReminderMessage
                                ? settings.customReminderMessage
                                    .replace(/{nome}/g, customer.name)
                                    .replace(/{marca}/g, brand)
                                    .trim()
                                : '';
                              return extraMessage ? `${greeting}\n\n${extraMessage}` : `${greeting}\n\nJust sending a message to keep in touch and confirm if you need any assistance today. ✨`;
                            })())}`} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="flex-1 px-4 py-3 bg-green-500 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2"
                          >
                            <MessageCircle size={16} fill="currentColor" /> WHATSAPP
                          </a>
                          <a 
                            href={`sms:${customer.phone.replace(/\D/g, '')}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodeURIComponent((() => {
                              const brand = settings.brandName || 'Easy Beauty';
                              const greeting = `Hello ${customer.name}! 👋 This is ${brand}.`;
                              const extraMessage = settings.customReminderMessage
                                ? settings.customReminderMessage
                                    .replace(/{nome}/g, customer.name)
                                    .replace(/{marca}/g, brand)
                                    .trim()
                                : '';
                              return extraMessage ? `${greeting}\n\n${extraMessage}` : `${greeting}\n\nJust sending a message to keep in touch and confirm if you need any assistance today. ✨`;
                            })())}`} 
                            className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2"
                          >
                            <MessageSquare size={16} /> SMS
                          </a>
                        </div>
                      </div>
                    ))
                  ) : (
                    reminderOrders.filter(order => {
                      const search = customerSearch.toLowerCase();
                      return order.customerName.toLowerCase().includes(search) || (order.phone && order.phone.includes(search));
                    }).map(order => (
                      <div key={order.id} className="glass p-6 rounded-3xl flex flex-col justify-between border-2 border-white/50 shadow-lg">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="font-bold text-xl">{order.customerName}</h4>
                            <p className="text-xs opacity-50 font-mono">{order.phone}</p>
                          </div>
                          <div className="px-3 py-1 bg-white/50 rounded-lg text-[10px] font-black uppercase border border-white/40">
                            {formatTimeToAMPM(order.appointmentTime)}
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <a href={`https://wa.me/${order.phone.replace(/\D/g, '')}?text=${encodeURIComponent(getReminderMessage(order, reminderMode))}`} target="_blank" rel="noreferrer" className="flex-1 px-4 py-3 bg-green-500 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2">
                            <MessageCircle size={16} fill="currentColor" /> WHATSAPP
                          </a>
                          <a href={`sms:${order.phone.replace(/\D/g, '')}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodeURIComponent(getReminderMessage(order, reminderMode))}`} className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2">
                            <MessageSquare size={16} /> SMS
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                  {((reminderMode !== 'custom' && reminderOrders.length === 0) || (reminderMode === 'custom' && customMessageClients.length === 0)) && (
                    <div className="py-20 text-center opacity-40 col-span-full">No customers found.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'finance' && (() => {
          const isOrderInFinanceRange = (o: Order) => {
            const dateStr = o.appointmentDate || o.pickupDate;
            if (!dateStr) return false;
            const orderDate = parseDateString(dateStr, o.orderLanguage || settings.language || 'pt');
            if (!orderDate) return false;
            
            const start = parseDateString(financeDateRange.start, settings.language || 'pt');
            const end = parseDateString(financeDateRange.end, settings.language || 'pt');
            
            if (start) start.setHours(0, 0, 0, 0);
            if (end) end.setHours(0, 0, 0, 0);
            
            if (start && orderDate < start) return false;
            if (end && orderDate > end) return false;
            return true;
          };

          return (
            <div className="space-y-8">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                <div className="space-y-1">
                  <h2 className="text-3xl font-serif font-bold">Financial Report</h2>
                  <p className="text-xs opacity-40 uppercase font-black tracking-widest text-black">Track earnings by professional and period</p>
                </div>
                <div className="flex flex-wrap gap-4 items-center bg-white/40 p-2 rounded-2xl border border-white/20 shadow-sm">
                  <div className="flex flex-col">
                    <label className="text-[10px] font-black uppercase opacity-40 ml-2">From</label>
                    <input 
                      type="date" 
                      className="p-2 bg-transparent text-sm font-bold outline-none"
                      value={financeDateRange.start}
                      onChange={e => setFinanceDateRange({ ...financeDateRange, start: e.target.value })}
                    />
                  </div>
                  <div className="h-8 w-px bg-black/10 mx-2" />
                  <div className="flex flex-col">
                    <label className="text-[10px] font-black uppercase opacity-40 ml-2">To</label>
                    <input 
                      type="date" 
                      className="p-2 bg-transparent text-sm font-bold outline-none"
                      value={financeDateRange.end}
                      onChange={e => setFinanceDateRange({ ...financeDateRange, end: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {professionals.map(prof => {
                  const profOrders = orders.filter(o => {
                    return o.status === 'completed' && 
                           isOrderInFinanceRange(o) &&
                           (o.professionalId === prof.id || o.items.some(item => item.professionalId === prof.id));
                  });

                  const totalRevenue = profOrders.reduce((sum, o) => {
                    const orderSubtotal = o.items.reduce((s, i) => s + (i.price * i.quantity), 0);
                    const profItemsTotal = o.items
                      .filter(item => item.professionalId === prof.id || (!item.professionalId && o.professionalId === prof.id))
                      .reduce((s, i) => s + (i.price * i.quantity), 0);
                    
                    if (orderSubtotal === 0) return sum + (o.professionalId === prof.id ? (o.total || 0) : 0);
                    const profShare = profItemsTotal / orderSubtotal;
                    return sum + (profShare * (o.total || 0));
                  }, 0);

                  const isSelected = selectedFinanceProf === prof.id;
                  const isAnySelected = selectedFinanceProf !== null;
                  const isDimmed = isAnySelected && !isSelected;

                  return (
                    <motion.div 
                      key={prof.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: isDimmed ? 0.45 : 1, y: 0 }}
                      onClick={() => {
                        if (selectedFinanceProf === prof.id) {
                          setSelectedFinanceProf(null);
                        } else {
                          setSelectedFinanceProf(prof.id);
                        }
                      }}
                      className={cn(
                        "bg-white/90 p-6 rounded-3xl cursor-pointer relative overflow-hidden transition-all border text-black flex flex-col justify-between",
                        isSelected 
                          ? "border-2 shadow-xl scale-[1.03]" 
                          : "border-black/10 shadow-sm hover:scale-[1.02] hover:opacity-100"
                      )}
                      style={{ 
                        borderLeft: isSelected ? `8px solid ${settings.primaryColor || '#865d39'}` : `4px solid ${settings.primaryColor || '#865d39'}`,
                        borderColor: isSelected ? (settings.primaryColor || '#865d39') : undefined,
                        boxShadow: isSelected ? `0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 0 15px ${settings.primaryColor || '#865d39'}44` : undefined
                      }}
                    >
                      {isSelected && (
                        <div 
                          className="absolute top-3 right-3 text-[8px] font-black uppercase tracking-widest text-white px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm"
                          style={{ backgroundColor: settings.primaryColor || '#865d39' }}
                        >
                          <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                          {settings.language === 'pt' ? 'Filtrado' : 'Filtered'}
                        </div>
                      )}
                      <div className="flex items-center gap-4 mb-6">
                        <div className="w-14 h-14 rounded-2xl overflow-hidden border-2 border-white shadow-sm">
                          <img src={prof.avatar || DEFAULT_LOGO} alt={prof.name} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-black">{prof.name}</h3>
                          <p className="text-[10px] opacity-40 uppercase font-black tracking-widest text-black">
                            {profOrders.length} {profOrders.length === 1 ? 'Appointment' : 'Appointments'}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase opacity-40 tracking-[0.2em] text-black">Gross Total</span>
                        <div className="text-3xl font-serif font-black" style={{ color: settings.primaryColor }}>
                          {currencySymbol} {totalRevenue.toFixed(2)}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="bg-white/90 rounded-3xl overflow-hidden shadow-xl border border-black/10 text-black">
                <div className="p-6 bg-white/50 border-b border-black/5 text-black">
                  <h3 className="font-bold flex items-center justify-between w-full text-black">
                    <span className="flex items-center gap-2">
                      <History size={20} className="opacity-40" />
                      {settings.language === 'pt' ? 'Histórico de Atendimentos no Período' : 'Appointment History in Period'}
                    </span>
                    {selectedFinanceProf && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFinanceProf(null);
                        }}
                        className="text-[10px] bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded-full flex items-center gap-1.5 font-extrabold uppercase transition-colors"
                      >
                        <X size={12} />
                        {settings.language === 'pt' ? 'Limpar Filtro' : 'Clear Filter'}
                      </button>
                    )}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-black/5 text-[10px] uppercase font-black tracking-widest opacity-40 text-black">
                      <tr>
                        <th className="p-4">Date</th>
                        <th className="p-4">Client</th>
                        <th className="p-4">Services</th>
                        <th className="p-4">Professional</th>
                        <th className="p-4">{settings.language === 'pt' ? 'Método' : 'Method'}</th>
                        <th className="p-4 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 text-black">
                      {orders
                        .filter(o => {
                          const isMatch = o.status === 'completed' && isOrderInFinanceRange(o);
                          if (!isMatch) return false;
                          if (selectedFinanceProf) {
                            return o.professionalId === selectedFinanceProf || o.items.some(it => it.professionalId === selectedFinanceProf);
                          }
                          return true;
                        })
                        .sort((a, b) => {
                          const dateA = parseDateString(a.appointmentDate || a.pickupDate || '', a.orderLanguage || settings.language || 'pt') || new Date(0);
                          const dateB = parseDateString(b.appointmentDate || b.pickupDate || '', b.orderLanguage || settings.language || 'pt') || new Date(0);
                          return dateB.getTime() - dateA.getTime();
                        })
                        .map(order => (
                          <tr key={order.id} className="hover:bg-white/30 transition-colors">
                            <td className="p-4 text-xs font-bold">{order.appointmentDate || order.pickupDate}</td>
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold">{order.customerName}</span>
                                <span className="text-[10px] opacity-40 font-mono">{order.phone}</span>
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-wrap gap-1">
                                {order.items.map((it, idx) => (
                                  <span key={idx} className="text-[9px] bg-white/50 px-2 py-0.5 rounded-full border border-black/5 font-bold uppercase">
                                    {it.title}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex flex-wrap gap-1">
                                {Array.from(new Set(order.items.map(it => it.professionalName).filter(Boolean))).map((name, idx) => (
                                  <span key={idx} className="text-[9px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-4 text-xs font-bold">
                              {order.paymentMethod ? (
                                <span className="px-2.5 py-1 bg-black text-white rounded-lg text-[9px] font-black uppercase tracking-wider">
                                  {order.paymentMethod}
                                </span>
                              ) : (
                                <span className="opacity-45 italic">—</span>
                              )}
                            </td>
                            <td className="p-4 text-right font-black" style={{ color: settings.primaryColor }}>
                              <div className="flex flex-col items-end">
                                <span>{currencySymbol} {order.total.toFixed(2)}</span>
                                {order.tip > 0 && (
                                  <span className="text-[8px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full uppercase tracking-tighter">+ Tip {currencySymbol}{order.tip.toFixed(2)}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      {orders.filter(o => o.status === 'completed' && isOrderInFinanceRange(o)).length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-10 text-center opacity-40 italic">Nenhum atendimento finalizado neste período.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {isEditingCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="glass p-8 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-black text-white">
                      <User size={20} />
                    </div>
                    <h3 className="text-xl font-bold">Customer Profile</h3>
                  </div>
                <button onClick={() => setIsEditingCustomer(null)} className="p-2 hover:bg-black/5 rounded-full"><X size={20} /></button>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-black/5 flex items-center justify-center text-2xl font-bold">
                    {editCustomerForm.name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">{editCustomerForm.name}</h3>
                    <p className="opacity-60">{editCustomerForm.phone}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-40">Name</label>
                    <input type="text" className="w-full p-3 rounded-xl border" value={editCustomerForm.name} onChange={e => setEditCustomerForm({...editCustomerForm, name: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-40">WhatsApp (Ex: (999) 999-9999)</label>
                    <input 
                      type="text" 
                      className="w-full p-3 rounded-xl border" 
                      placeholder="(999) 999-9999"
                      value={editCustomerForm.phone} 
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
                        setEditCustomerForm({...editCustomerForm, phone: formatted});
                      }} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-40">Instagram</label>
                    <input type="text" className="w-full p-3 rounded-xl border" value={editCustomerForm.instagram || ''} onChange={e => setEditCustomerForm({...editCustomerForm, instagram: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase opacity-40">Birthday</label>
                    <input type="text" className="w-full p-3 rounded-xl border" value={editCustomerForm.birthday} onChange={e => setEditCustomerForm({...editCustomerForm, birthday: e.target.value})} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[10px] font-bold uppercase opacity-40">Email</label>
                    <input type="text" className="w-full p-3 rounded-xl border" value={editCustomerForm.email || ''} onChange={e => setEditCustomerForm({...editCustomerForm, email: e.target.value})} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[10px] font-bold uppercase opacity-40">Address</label>
                    <textarea className="w-full p-3 rounded-xl border" rows={2} value={editCustomerForm.address || ''} onChange={e => setEditCustomerForm({...editCustomerForm, address: e.target.value})} />
                  </div>
                </div>

                  <div className="space-y-4 pt-4 border-t">
                    <h4 className="font-bold flex items-center gap-2">
                      <MessageSquare size={18} /> General Customer Notes
                    </h4>
                    <div className="space-y-2">
                      <textarea 
                        className="w-full p-4 rounded-2xl border bg-white shadow-sm focus:ring-2 focus:ring-black/5" 
                        rows={10} 
                        placeholder="Space for detailed notes on customer history, preferences, filled anamnese forms, and general observations..."
                        value={editCustomerForm.notes || ''}
                        onChange={e => setEditCustomerForm({...editCustomerForm, notes: e.target.value})}
                      />
                    </div>
                  </div>

                <div className="space-y-4 pt-4 border-t">
                  <h4 className="font-bold border-b pb-2 flex items-center gap-2">
                    <History size={18} /> Appointment History
                  </h4>
                  
                  <div className="space-y-3">
                    {orders
                      .filter(o => o.phone === editCustomerForm.phone || o.customerName === editCustomerForm.name)
                      .sort((a, b) => {
                        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
                        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
                        return dateB - dateA;
                      })
                      .map((order, idx) => (
                        <div key={idx} className="p-4 bg-white/50 rounded-2xl border border-white/20 space-y-2">
                          <div className="flex justify-between items-start">
                            <div className="text-xs font-bold opacity-40 uppercase">
                              {order.appointmentDate || order.pickupDate} {formatTimeToAMPM(order.appointmentTime)}
                            </div>
                            <div className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase",
                              order.status === 'completed' ? "bg-green-100 text-green-600" : "bg-yellow-100 text-yellow-600"
                            )}>
                              {order.status === 'completed' ? 'Completed' : 'Pending'}
                            </div>
                          </div>
                          <div className="space-y-1">
                            {order.items.map((item, i) => (
                              <div key={i} className="text-sm flex justify-between">
                                <span>{item.quantity}x {item.title}</span>
                                <span className="opacity-60">{currencySymbol} {(item.price * item.quantity).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="pt-2 border-t flex justify-between items-end">
                            <div className="space-y-1">
                              <span className="text-[10px] font-bold opacity-40 uppercase block">Total</span>
                              <span className="font-bold">{currencySymbol} {order.total.toFixed(2)}</span>
                            </div>
                            <div className="flex gap-2 items-center">
                              {order.paymentMethod && (
                                <div className="text-right space-y-1">
                                  <span className="text-[10px] font-bold opacity-40 uppercase block">Method</span>
                                  <span className="text-xs font-medium opacity-80">{order.paymentMethod}</span>
                                </div>
                              )}
                              <button 
                                onClick={() => {
                                  const note = prompt('Edit notes for this service:', order.formulaNotes || '');
                                  if (note !== null) {
                                    updateDoc(doc(db, 'pedidos', order.id), { formulaNotes: note });
                                    toast.success('Notes updated!');
                                  }
                                }}
                                className="p-1 hover:bg-black/5 rounded"
                                title="Edit Notes"
                              >
                                <Edit2 size={12} />
                              </button>
                            </div>
                          </div>
                          {order.formulaNotes && (
                            <div className="p-2 bg-black/5 rounded-lg border border-black/5 text-[10px] opacity-70">
                              <span className="font-bold uppercase block mb-1">Service Notes:</span>
                              {order.formulaNotes}
                            </div>
                          )}
                        </div>
                      ))}
                    {orders.filter(o => o.phone === editCustomerForm.phone || o.customerName === editCustomerForm.name).length === 0 && (
                      <p className="text-xs opacity-40 italic text-center py-4">No appointments found.</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button onClick={updateCustomer} className="flex-1 py-4 rounded-xl font-bold text-lg" style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}>Save Changes</button>
                  <button onClick={() => setIsEditingCustomer(null)} className="flex-1 py-4 rounded-xl bg-gray-100 hover:bg-gray-200 transition-all font-bold text-lg text-black border border-black/5">Close</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {(isManualBooking || isEditingOrder) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm">
            <div className="glass p-6 sm:p-8 rounded-[2rem] w-full max-w-4xl max-h-[95vh] overflow-y-auto space-y-8 relative border border-white/40 shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-2xl font-serif font-black" style={{ color: settings.primaryColor }}>
                    {isEditingOrder ? 'Edit Appointment' : 'New Appointment'}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={cn("w-2 h-2 rounded-full", manualBookingStep === 'client' ? "bg-black" : "bg-black/20")} />
                    <div className={cn("w-2 h-2 rounded-full", manualBookingStep === 'services' ? "bg-black" : "bg-black/20")} />
                    <div className={cn("w-2 h-2 rounded-full", manualBookingStep === 'schedule' ? "bg-black" : "bg-black/20")} />
                  </div>
                </div>
                <button 
                  onClick={() => { setIsManualBooking(false); setIsEditingOrder(null); setManualBookingStep('client'); }} 
                  className="p-3 hover:bg-black/5 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <AnimatePresence mode="wait">
                {manualBookingStep === 'client' && (
                  <motion.div 
                    key="step-client"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="space-y-4">
                      <h4 className="font-bold text-lg opacity-80 text-black">1. Which customer?</h4>
                      <div className="relative">
                        <Users size={18} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30 text-black" />
                        <input 
                          type="text" 
                          placeholder="Search by name or phone..." 
                          className="w-full pl-12 pr-4 py-4 rounded-2xl border bg-white/50 focus:ring-2 outline-none font-sans text-black"
                          value={clientSearchTerm}
                          onChange={e => setClientSearchTerm(e.target.value)}
                        />
                      </div>

                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {uniqueCustomers.filter(c => 
                          c.name.toLowerCase().includes(clientSearchTerm.toLowerCase()) || 
                          c.phone.includes(clientSearchTerm)
                        ).slice(0, 5).map(customer => (
                          <button 
                            key={customer.phone || customer.name}
                            onClick={() => {
                              setManualBookingData({ ...manualBookingData, customerName: customer.name, phone: customer.phone });
                              setManualBookingStep('services');
                            }}
                            className="w-full p-4 rounded-2xl border bg-white hover:border-black transition-all text-left flex items-center justify-between group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-black/5 flex items-center justify-center font-bold text-black">{customer.name.charAt(0)}</div>
                              <div>
                                <div className="font-bold text-black">{customer.name}</div>
                                <div className="text-xs opacity-40 leading-none text-black">{customer.phone}</div>
                              </div>
                            </div>
                            <Plus size={18} className="opacity-0 group-hover:opacity-100 transition-opacity text-black" />
                          </button>
                        ))}
                        {clientSearchTerm.length > 2 && (
                          <button 
                            onClick={() => {
                              setManualBookingStep('services');
                            }}
                            className="w-full p-4 rounded-2xl border border-dashed border-black/20 hover:border-black/40 transition-all text-left flex items-center gap-3 bg-black/[0.02]"
                          >
                            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white"><Plus size={18} /></div>
                            <div>
                              <div className="font-bold italic text-black">Use Manual Data</div>
                              <div className="text-xs opacity-40 text-black">Continue with typed information</div>
                            </div>
                          </button>
                        )}
                      </div>
                      
                      {!isEditingOrder && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-2 text-black">Full Name</label>
                            <input 
                              type="text" 
                              className="w-full p-4 rounded-xl border bg-white text-black"
                              value={manualBookingData.customerName}
                              onChange={e => setManualBookingData({ ...manualBookingData, customerName: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-2 text-black">WhatsApp (Number only)</label>
                            <input 
                              type="text" 
                              placeholder="(000) 000-0000"
                              className="w-full p-4 rounded-xl border bg-white text-black"
                              value={manualBookingData.phone}
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
                                setManualBookingData({...manualBookingData, phone: formatted});
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-2 text-black">Email (Optional)</label>
                            <input 
                              type="email" 
                              className="w-full p-4 rounded-xl border bg-white text-black"
                              value={(manualBookingData as any).email || ''}
                              onChange={e => setManualBookingData({ ...manualBookingData, email: e.target.value } as any)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-2 text-black">Instagram (Optional)</label>
                            <div className="relative">
                              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/40 font-bold">@</span>
                              <input 
                                type="text" 
                                className="w-full p-4 pl-10 rounded-xl border bg-white text-black"
                                value={(manualBookingData as any).instagram || ''}
                                onChange={e => setManualBookingData({ ...manualBookingData, instagram: e.target.value } as any)}
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-2 text-black">Birth Date (Optional)</label>
                            <input 
                              type="date" 
                              className="w-full p-4 rounded-xl border bg-white text-black"
                              value={(manualBookingData as any).birthDate || ''}
                              onChange={e => setManualBookingData({ ...manualBookingData, birthDate: e.target.value } as any)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-2 text-black">How did you meet us?</label>
                            <select 
                              className="w-full p-4 rounded-xl border bg-white text-black h-[58px]"
                              value={(manualBookingData as any).howMetUs || ''}
                              onChange={e => setManualBookingData({ ...manualBookingData, howMetUs: e.target.value } as any)}
                            >
                              <option value="">Select...</option>
                              <option value="Instagram">Instagram</option>
                              <option value="Google">Google</option>
                              <option value="Indication">Indication/Referral</option>
                              <option value="Passando em frente">Walk-in</option>
                              <option value="Outro">Other</option>
                            </select>
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-2 text-black">Address</label>
                            <input 
                              type="text" 
                              placeholder="City, State, Street, Number..."
                              className="w-full p-4 rounded-xl border bg-white text-black"
                              value={(manualBookingData as any).address || ''}
                              onChange={e => setManualBookingData({ ...manualBookingData, address: e.target.value } as any)}
                            />
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                    <div className="flex gap-4 pt-4">
                      <button 
                        disabled={!manualBookingData.customerName || !manualBookingData.phone}
                        onClick={() => setManualBookingStep('services')}
                        className="flex-1 py-4 rounded-2xl font-bold text-lg shadow-xl disabled:opacity-30 transition-all text-black"
                        style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                      >
                        Continue to Services
                      </button>
                    </div>
                  </motion.div>
                )}

                {manualBookingStep === 'services' && (
                  <motion.div 
                    key="step-services"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6 text-black"
                  >
                    <div className="space-y-4">
                      <h4 className="font-bold text-lg opacity-80">2. Which services and professionals?</h4>
                      
                      <div className="space-y-3">
                        {manualBookingData.items?.map((item, idx) => (
                          <div key={idx} className="p-4 rounded-2xl border bg-white space-y-4 shadow-sm relative overflow-hidden group">
                            <div className="flex justify-between items-start">
                              <div className="space-y-1">
                                <div className="font-bold text-lg">{item.title}</div>
                                <div className="text-xs opacity-60 flex items-center gap-1 font-mono uppercase">
                                  {currencySymbol} {item.price.toFixed(2)} • {item.duration || 0} min
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  const newItems = [...(manualBookingData.items || [])];
                                  newItems.splice(idx, 1);
                                  setManualBookingData({ ...manualBookingData, items: newItems });
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-black uppercase opacity-40 ml-2">Responsible Professional</label>
                              <div className="flex flex-wrap gap-2">
                                {professionals.filter(p => !item.department || p.departments.includes(item.department)).map(p => (
                                  <button 
                                    key={p.id}
                                    onClick={() => {
                                      const newItems = [...(manualBookingData.items || [])];
                                      newItems[idx].professionalId = p.id;
                                      newItems[idx].professionalName = p.name;
                                      setManualBookingData({ ...manualBookingData, items: newItems });
                                    }}
                                    className={cn(
                                      "px-3 py-2 rounded-xl text-[10px] font-bold border transition-all flex items-center gap-2",
                                      item.professionalId === p.id 
                                        ? "bg-black text-white border-black" 
                                        : "bg-white border-black/20 hover:border-black/40 text-black shadow-sm"
                                    )}
                                  >
                                    <div className="w-5 h-5 rounded-full overflow-hidden border border-black/10">
                                      <img src={p.avatar || DEFAULT_LOGO} className="w-full h-full object-cover" />
                                    </div>
                                    {p.name.split(' ')[0]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}

                        <div className="p-4 border-2 border-dashed rounded-2xl space-y-3 bg-black/[0.01]" style={{ borderColor: settings.primaryColor + '20' }}>
                          <label className="text-[10px] font-black uppercase opacity-40 ml-2 tracking-widest">+ Add Service</label>
                          
                          <div className="relative">
                            <input
                              type="text"
                              placeholder={settings.language === 'pt' ? "Pesquisar serviço no catálogo..." : "Search service in catalog..."}
                              className="w-full p-3.5 pl-10 rounded-xl border bg-white shadow-sm outline-none font-sans text-sm text-black focus:ring-1 transition-all"
                              style={{ borderColor: 'rgba(0,0,0,0.1)' }}
                              value={manualBookingServiceSearch}
                              onChange={(e) => setManualBookingServiceSearch(e.target.value)}
                            />
                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-30 text-black pointer-events-none" />
                            {manualBookingServiceSearch && (
                              <button
                                type="button"
                                onClick={() => setManualBookingServiceSearch('')}
                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold opacity-40 hover:opacity-100 text-black px-1.5 py-0.5 hover:bg-black/5 rounded"
                              >
                                {settings.language === 'pt' ? 'Limpar' : 'Clear'}
                              </button>
                            )}

                            {manualBookingServiceSearch && (
                              <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-50 divide-y divide-gray-100">
                                {categories.filter(c => {
                                  const currentDept = 
                                    deptLoggedIn.hair ? 'hair' : 
                                    deptLoggedIn.makeup ? 'makeup' : 
                                    deptLoggedIn.nails ? 'nails' : 
                                    deptLoggedIn.spa ? 'spa' :
                                    deptLoggedIn.clinic ? 'clinic' :
                                    deptLoggedIn.aesthetic ? 'aesthetic' : 
                                    null;
                                  return !currentDept || c.department === currentDept;
                                }).map(cat => {
                                  const searchNormal = (manualBookingServiceSearch || "")
                                    .toLowerCase()
                                    .normalize("NFD")
                                    .replace(/[\u0300-\u036f]/g, "");

                                  const filteredProducts = products.filter(p => {
                                    const titleNormal = (p.title || "")
                                      .toLowerCase()
                                      .normalize("NFD")
                                      .replace(/[\u0300-\u036f]/g, "");

                                    return (
                                      p.categoryId === cat.id && 
                                      p.isActive !== false &&
                                      titleNormal.includes(searchNormal)
                                    );
                                  });

                                  if (filteredProducts.length === 0) return null;

                                  return (
                                    <div key={cat.id} className="p-2">
                                      <div className="text-[10px] font-black uppercase text-gray-400 px-3 py-1 bg-gray-50/50 rounded-md mb-1">
                                        {cat.title}
                                      </div>
                                      <div className="space-y-0.5">
                                        {filteredProducts.map(p => (
                                          <button
                                            key={p.id}
                                            type="button"
                                            className="w-full text-left px-3 py-2 rounded-lg text-sm text-black hover:bg-gray-100 transition-colors flex justify-between items-center"
                                            onClick={() => {
                                              const newItems = [...(manualBookingData.items || [])];
                                              
                                              // Auto-assign professional if there's only one for this department
                                              const availableProfs = professionals.filter(prof => !p.department || prof.departments.includes(p.department));
                                              const defaultProf = availableProfs.length === 1 ? availableProfs[0] : null;

                                              newItems.push({
                                                productId: p.id,
                                                title: p.title,
                                                price: p.price,
                                                quantity: 1,
                                                duration: p.duration || 30,
                                                department: p.department,
                                                appointmentDate: manualBookingData.appointmentDate,
                                                appointmentTime: manualBookingData.appointmentTime,
                                                professionalId: defaultProf?.id,
                                                professionalName: defaultProf?.name
                                              });
                                              setManualBookingData({ ...manualBookingData, items: newItems });
                                              setManualBookingServiceSearch('');
                                            }}
                                          >
                                            <span className="font-medium text-black">{p.title}</span>
                                            <span className="text-xs opacity-60 ml-2 font-semibold text-black shrink-0">
                                              {currencySymbol} {p.price.toFixed(2)} ({p.duration || 30} min)
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                                {(() => {
                                  // Check if we have absolutely zero filtered results across all categories
                                  const anyResults = categories.some(c => {
                                    const currentDept = 
                                      deptLoggedIn.hair ? 'hair' : 
                                      deptLoggedIn.makeup ? 'makeup' : 
                                      deptLoggedIn.nails ? 'nails' : 
                                      deptLoggedIn.spa ? 'spa' :
                                      deptLoggedIn.clinic ? 'clinic' :
                                      deptLoggedIn.aesthetic ? 'aesthetic' : 
                                      null;
                                    if (currentDept && c.department !== currentDept) return false;

                                    const searchNormal = (manualBookingServiceSearch || "")
                                      .toLowerCase()
                                      .normalize("NFD")
                                      .replace(/[\u0300-\u036f]/g, "");

                                    const count = products.filter(p => 
                                      p.categoryId === c.id && 
                                      p.isActive !== false &&
                                      ((p.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(searchNormal))
                                    ).length;
                                    return count > 0;
                                  });

                                  if (!anyResults) {
                                    return (
                                      <div className="p-4 text-center text-sm text-gray-500 font-medium">
                                        {settings.language === 'pt' ? 'Nenhum serviço encontrado.' : 'No services found.'}
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            )}
                          </div>

                          <select 
                            key={`manual-booking-select-${manualBookingServiceSearch}`}
                            className="w-full p-4 rounded-2xl border bg-white shadow-sm outline-none font-sans text-sm text-black"
                            onChange={(e) => {
                              const prod = products.find(p => p.id === e.target.value);
                              if (prod) {
                                const newItems = [...(manualBookingData.items || [])];
                                
                                // Auto-assign professional if there's only one for this department
                                const availableProfs = professionals.filter(p => !prod.department || p.departments.includes(prod.department));
                                const defaultProf = availableProfs.length === 1 ? availableProfs[0] : null;

                                newItems.push({
                                  productId: prod.id,
                                  title: prod.title,
                                  price: prod.price,
                                  quantity: 1,
                                  duration: prod.duration || 30,
                                  department: prod.department,
                                  appointmentDate: manualBookingData.appointmentDate,
                                  appointmentTime: manualBookingData.appointmentTime,
                                  professionalId: defaultProf?.id,
                                  professionalName: defaultProf?.name
                                });
                                setManualBookingData({ ...manualBookingData, items: newItems });
                                e.target.value = '';
                                setManualBookingServiceSearch('');
                              }
                            }}
                          >
                            <option value="">{settings.language === 'pt' ? 'Selecione o serviço...' : 'Select service...'}</option>
                            {categories.filter(c => {
                              const currentDept = 
                                deptLoggedIn.hair ? 'hair' : 
                                deptLoggedIn.makeup ? 'makeup' : 
                                deptLoggedIn.nails ? 'nails' : 
                                deptLoggedIn.spa ? 'spa' :
                                deptLoggedIn.clinic ? 'clinic' :
                                deptLoggedIn.aesthetic ? 'aesthetic' : 
                                null;
                              return !currentDept || c.department === currentDept;
                            }).map(cat => {
                              const searchNormal = (manualBookingServiceSearch || "")
                                .toLowerCase()
                                .normalize("NFD")
                                .replace(/[\u0300-\u036f]/g, "");

                              const filteredProducts = products.filter(p => {
                                const titleNormal = (p.title || "")
                                  .toLowerCase()
                                  .normalize("NFD")
                                  .replace(/[\u0300-\u036f]/g, "");

                                return (
                                  p.categoryId === cat.id && 
                                  p.isActive !== false &&
                                  (!searchNormal || titleNormal.includes(searchNormal))
                                );
                              });
                              
                              if (filteredProducts.length === 0) return null;

                              return (
                                <optgroup key={cat.id} label={cat.title}>
                                  {filteredProducts.map(p => (
                                    <option key={p.id} value={p.id}>{p.title} - {currencySymbol} {p.price.toFixed(2)} ({p.duration || 30} min)</option>
                                  ))}
                                </optgroup>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-4 pt-4">
                      <button 
                        onClick={() => setManualBookingStep('client')}
                        className="px-8 py-4 rounded-2xl bg-black/5 font-bold text-lg hover:bg-black/10 transition-all text-black"
                      >
                        Back
                      </button>
                      <button 
                        disabled={!manualBookingData.items?.length || manualBookingData.items.some(i => !i.professionalId)}
                        onClick={() => {
                          const anamneseItem = manualBookingData.items?.find(item => {
                            const product = products.find(p => p.id === item.productId);
                            return product?.anamneseFormId;
                          });
                          if (anamneseItem) {
                            const product = products.find(p => p.id === anamneseItem.productId);
                            const form = anamneseForms.find(f => f.id === product?.anamneseFormId);
                            setActiveManualAnamneseForm(form || null);
                          } else {
                            setActiveManualAnamneseForm(null);
                          }
                          setManualBookingStep('schedule');
                        }}
                        className="flex-1 py-4 rounded-2xl font-bold text-lg shadow-xl disabled:opacity-30 transition-all active:scale-[0.98]"
                        style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                      >
                        Continue to Schedule
                      </button>
                    </div>
                  </motion.div>
                )}

                {manualBookingStep === 'schedule' && (
                  <motion.div 
                    key="step-schedule"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="space-y-6">
                      <h4 className="font-bold text-lg opacity-80 text-black">3. When will it be?</h4>
                      
                      <div className="grid grid-cols-1 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-black uppercase opacity-40 ml-2 text-black">Date</label>
                          <input 
                            type="date" 
                            className="w-full p-4 rounded-2xl border bg-white shadow-sm font-sans text-black"
                            value={manualBookingData.appointmentDate}
                            onChange={e => {
                               const newDate = e.target.value;
                               const newItems = manualBookingData.items?.map(i => ({ ...i, appointmentDate: newDate })) || [];
                               setManualBookingData({ ...manualBookingData, appointmentDate: newDate, items: newItems, appointmentTime: '' });
                            }}
                          />
                        </div>
                        
                        <div className="space-y-4">
                          <div className="flex flex-col sm:flex-row gap-4 sm:items-end bg-gray-50 p-4 rounded-2xl border border-black/5">
                            <div className="flex-1 space-y-2">
                              <label className="text-xs font-black uppercase opacity-40 ml-2 text-black">
                                {settings.language === 'pt' ? 'Horário Personalizado (Livre)' : 'Custom Time (Free Selection)'}
                              </label>
                              <input 
                                type="time" 
                                className="w-full p-4 rounded-xl border bg-white shadow-sm font-mono text-black"
                                value={(() => {
                                  if (!manualBookingData.appointmentTime) return '';
                                  return normalizeTo24h(manualBookingData.appointmentTime);
                                })()}
                                onChange={e => {
                                  const time24 = e.target.value;
                                  if (!time24) return;
                                  const [hStr, mStr] = time24.split(':');
                                  const hour = parseInt(hStr, 10);
                                  const ampm = hour >= 12 ? 'PM' : 'AM';
                                  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
                                  const displayTime = `${displayHour.toString().padStart(2, '0')}:${mStr} ${ampm}`;
                                  
                                  const newItems = (manualBookingData.items || []).map(i => ({ ...i, appointmentTime: displayTime }));
                                  setManualBookingData({ ...manualBookingData, appointmentTime: displayTime, items: newItems });
                                }}
                              />
                            </div>
                            {manualBookingData.appointmentTime && (
                              <div className="bg-white px-4 py-3.5 rounded-xl border font-bold text-xs uppercase flex flex-col justify-center items-center shadow-sm">
                                <span className="text-[10px] opacity-40 uppercase font-black">Selected</span>
                                <span className="text-sm font-black text-black">{manualBookingData.appointmentTime}</span>
                              </div>
                            )}
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-black uppercase opacity-40 ml-2 text-black">
                              {settings.language === 'pt' ? 'Sugestões de Horários (De 15 em 15 min - Autonomia)' : 'Time Suggestions (Every 15 min - Autonomy)'}
                            </label>
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[220px] overflow-y-auto p-2 border rounded-2xl bg-gray-50/30">
                              {(() => {
                                if (!manualBookingData.appointmentDate) return null;
                                
                                const slots: string[] = [];
                                let current = new Date(`${manualBookingData.appointmentDate}T07:00:00`);
                                const end = new Date(`${manualBookingData.appointmentDate}T21:00:00`);
                                while (current <= end) {
                                  const timeStr = current.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                                  slots.push(timeStr);
                                  current = new Date(current.getTime() + 15 * 60000);
                                }
                                
                                return slots.map(slot => {
                                  const parts = slot.split(':');
                                  let displayTime = slot;
                                  if (parts.length >= 2) {
                                    const hour = parseInt(parts[0], 10);
                                    const minutes = parts[1];
                                    const ampm = hour >= 12 ? 'PM' : 'AM';
                                    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
                                    displayTime = `${displayHour.toString().padStart(2, '0')}:${minutes} ${ampm}`;
                                  }
                                  const isSelected = manualBookingData.appointmentTime === slot || manualBookingData.appointmentTime === displayTime || normalizeTo24h(manualBookingData.appointmentTime || '') === slot;
                                  return (
                                    <button 
                                      key={slot}
                                      type="button"
                                      onClick={() => {
                                        const newItems = (manualBookingData.items || []).map(i => ({ ...i, appointmentTime: displayTime }));
                                        setManualBookingData({ ...manualBookingData, appointmentTime: displayTime, items: newItems });
                                      }}
                                      className={cn(
                                        "p-2.5 rounded-xl border text-xs font-bold transition-all",
                                        isSelected 
                                          ? "text-white shadow-lg scale-105 font-black" 
                                          : "bg-white hover:bg-gray-100 text-black border-black/5"
                                      )}
                                      style={isSelected ? { backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) } : {}}
                                    >
                                      {displayTime}
                                    </button>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>

                      {activeManualAnamneseForm && (
                        <div className="p-6 bg-red-50 rounded-3xl space-y-4 border border-red-100">
                          <h5 className="text-xs font-black uppercase text-red-600 tracking-widest flex items-center gap-2">
                            <ClipboardList size={16} /> 
                            Mandatory Anamnese Form
                          </h5>
                          <div className="space-y-4">
                            {activeManualAnamneseForm.questions.map((q) => (
                              <div key={q.id} className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-black opacity-60">
                                  {q.label} {q.required && '*'}
                                </label>
                                {q.type === 'text' ? (
                                  <textarea 
                                    className="w-full p-3 rounded-xl border bg-white outline-none text-sm text-black"
                                    value={manualBookingAnamneseAnswers[q.id] || ''}
                                    onChange={(e) => setManualBookingAnamneseAnswers({ ...manualBookingAnamneseAnswers, [q.id]: e.target.value })}
                                    rows={2}
                                  />
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {q.options?.map((opt) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => setManualBookingAnamneseAnswers({ ...manualBookingAnamneseAnswers, [q.id]: opt })}
                                        className={cn(
                                          "px-4 py-2 rounded-xl border font-bold text-[10px] transition-all",
                                          manualBookingAnamneseAnswers[q.id] === opt 
                                            ? "bg-black text-white border-black" 
                                            : "bg-white border-black/5 text-black"
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
                        </div>
                      )}

                      <div className="p-6 bg-black/[0.02] rounded-3xl space-y-4 border border-black/5">
                        <h5 className="text-[10px] font-black uppercase opacity-40 tracking-widest text-black">Booking Summary</h5>
                        <div className="flex items-center gap-4 border-b border-black/5 pb-4">
                          <div className="w-12 h-12 rounded-full bg-black/10 flex items-center justify-center font-bold text-lg text-black">
                            {manualBookingData.customerName?.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-lg text-black">{manualBookingData.customerName}</div>
                            <div className="text-sm opacity-60 font-medium font-sans text-black">{manualBookingData.phone}</div>
                          </div>
                        </div>
                        <div className="space-y-3 text-black">
                          {manualBookingData.items?.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-white p-3 rounded-xl border border-black/5 shadow-sm">
                              <div>
                                <span className="font-bold text-sm block">{item.title}</span>
                                <span className="text-[10px] opacity-40 uppercase font-black tracking-widest">{item.professionalName}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold text-sm block">{currencySymbol} {item.price.toFixed(2)}</span>
                                <span className="text-[10px] font-mono opacity-40">{item.duration} min</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Notes and Discount Fields */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-black/5">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-1 text-black">Notes (Optional)</label>
                            <textarea 
                              placeholder="Any agreement or special notes..."
                              className="w-full p-3 rounded-xl border border-black/10 bg-white/60 text-sm text-black focus:ring-1 focus:ring-black outline-none min-h-[44px] resize-none"
                              value={manualBookingData.notes || ''}
                              onChange={e => setManualBookingData({ ...manualBookingData, notes: e.target.value })}
                              rows={1}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase opacity-40 ml-1 text-black">Discount ({currencySymbol})</label>
                            <input 
                              type="number" 
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              className="w-full p-3 rounded-xl border border-black/10 bg-white/60 text-sm text-black focus:ring-1 focus:ring-black outline-none font-sans"
                              value={manualBookingData.discount || ''}
                              onChange={e => {
                                const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                                setManualBookingData({ ...manualBookingData, discount: isNaN(val) ? 0 : val });
                              }}
                            />
                          </div>
                        </div>

                        {/* Subtotal & Discount breakdown */}
                        {parseFloat(manualBookingData.discount as any) > 0 && (
                          <div className="space-y-1.5 text-xs text-black/60 pt-4 border-t border-black/5">
                            <div className="flex justify-between">
                              <span>Subtotal</span>
                              <span>{currencySymbol} {(manualBookingData.items?.reduce((s, i) => s + (i.price * i.quantity), 0) || 0).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600 font-semibold">
                              <span>Discount</span>
                              <span>-{currencySymbol} {parseFloat(manualBookingData.discount as any).toFixed(2)}</span>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between items-center pt-4 border-t border-black/5">
                          <span className="font-black uppercase text-xs opacity-40 tracking-widest text-black">Total</span>
                          <span className="text-2xl font-black" style={{ color: settings.primaryColor }}>
                            {currencySymbol} {Math.max(0, (manualBookingData.items?.reduce((s, i) => s + (i.price * i.quantity), 0) || 0) - (parseFloat(manualBookingData.discount as any) || 0)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-4 pt-4">
                      <button 
                        onClick={() => setManualBookingStep('services')}
                        className="px-8 py-4 rounded-2xl bg-black/5 font-bold text-lg hover:bg-black/10 transition-all text-black"
                      >
                        Back
                      </button>
                      <button 
                        disabled={
                          !manualBookingData.appointmentDate || 
                          !manualBookingData.appointmentTime ||
                          (activeManualAnamneseForm?.questions.some(q => q.required && !manualBookingAnamneseAnswers[q.id]))
                        }
                        onClick={handleManualBookingSubmit}
                        className="flex-1 py-4 rounded-2xl font-bold text-lg shadow-2xl disabled:opacity-30 transition-all hover:scale-[1.01] active:scale-[0.99]"
                        style={{ backgroundColor: settings.primaryColor, color: getContrastColor(settings.primaryColor) }}
                      >
                        {isEditingOrder ? 'Update Appointment' : 'Confirm Appointment'}
                      </button>
                      {isEditingOrder && !isAttendingOrder && (
                        <button 
                          onClick={() => {
                            setIsOpeningGap(isEditingOrder);
                            setGapInput({ 
                              start: isEditingOrder.gapStart || '', 
                              end: isEditingOrder.gapEnd || '' 
                            });
                          }}
                          className="p-4 rounded-2xl bg-black text-white hover:bg-black/90 transition-all shadow-xl flex items-center justify-center gap-2"
                          title="Abrir Vaga Extra"
                        >
                          <Calendar size={20} />
                          <span className="font-bold">Abrir Vaga</span>
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-3xl w-full max-w-sm shadow-2xl text-center space-y-6">
              <h3 className="text-xl font-bold text-black">{confirmModal.title}</h3>
              <p className="text-black/60">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} className="flex-1 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 transition-all font-bold text-black border border-black/5">Cancel</button>
                <button onClick={confirmModal.onConfirm} className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 transition-all text-white font-bold shadow-md">Delete</button>
              </div>
            </div>
          </div>
        )}
        {isAttendingOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white p-4 sm:p-8 rounded-3xl w-full max-w-2xl max-h-[95vh] overflow-y-auto space-y-8" style={{ '--text-color': '#111827', color: '#111827' } as React.CSSProperties}>
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1">
                  <h3 className="text-xl sm:text-3xl font-serif font-bold break-words" style={{ color: settings.primaryColor }}>Service: {isAttendingOrder.customerName}</h3>
                  <p className="text-xs opacity-50 font-bold uppercase tracking-wider">
                    {isAttendingOrder.phone} • {isAttendingOrder.email || 'No emailStr'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button 
                    onClick={() => {
                      setConfirmModal({
                        isOpen: true,
                        title: settings.language === 'pt' ? 'Excluir Agendamento' : 'Delete Appointment',
                        message: settings.language === 'pt' ? 'Tem certeza que deseja excluir permanentemente este agendamento?' : 'Are you sure you want to permanently delete this appointment?',
                        onConfirm: async () => {
                          try {
                            await deleteDoc(doc(db, 'pedidos', isAttendingOrder.id));
                            setIsAttendingOrder(null);
                            setAttendingStep(1);
                            setConfirmModal(prev => ({ ...prev, isOpen: false }));
                            toast.success(settings.language === 'pt' ? 'Agendamento excluído com sucesso!' : 'Appointment deleted successfully!');
                          } catch (err) {
                            toast.error('Error deleting appointment.');
                          }
                        }
                      });
                    }}
                    className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-all shadow-sm"
                    title={settings.language === 'pt' ? 'Excluir Agendamento' : 'Delete Appointment'}
                  >
                    <Trash2 size={20} />
                  </button>
                  <button onClick={() => { setIsAttendingOrder(null); setAttendingStep(1); }} className="p-2 hover:bg-black/5 rounded-full" style={{ color: settings.primaryColor }}><X size={24} /></button>
                </div>
              </div>

              {isAttendingOrder.status === 'completed' ? (
                <div className="space-y-6 text-black">
                  <div className="p-4 rounded-2xl bg-green-50 border border-green-100 flex items-center gap-3">
                    <CheckCircle2 className="text-green-600 shrink-0" size={24} />
                    <div>
                      <h4 className="font-bold text-green-800 text-sm">
                        {settings.language === 'pt' ? 'Atendimento Finalizado' : 'Appointment Completed'}
                      </h4>
                      <p className="text-xs text-green-700/80">
                        {settings.language === 'pt' 
                          ? 'Este atendimento já foi concluído e dado baixa.' 
                          : 'This appointment has already been completed and finalized.'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h5 className="text-xs font-bold uppercase opacity-40 tracking-wider text-black">
                      {settings.language === 'pt' ? 'Serviços Prestados' : 'Services Provided'}
                    </h5>
                    <div className="space-y-2">
                      {isAttendingOrder.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between items-center p-4 bg-white rounded-2xl border border-black/5 shadow-sm text-black">
                          <div>
                            <div className="font-bold text-black text-sm">{item.title}</div>
                            {item.professionalName && (
                              <span className="text-[10px] bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full font-black uppercase inline-block mt-1">
                                {item.professionalName}
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="font-mono text-sm font-bold text-black">
                              {item.quantity}x {currencySymbol} {item.price.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Payment Details */}
                  <div className="p-6 bg-gray-50 rounded-2xl border border-black/5 space-y-4">
                    <h5 className="text-xs font-bold uppercase opacity-50 tracking-wider text-black">
                      {settings.language === 'pt' ? 'Resumo de Pagamento' : 'Payment Summary'}
                    </h5>
                    <div className="space-y-2 text-xs text-black">
                      <div className="flex justify-between text-black/60">
                        <span>Subtotal</span>
                        <span className="font-mono">{currencySymbol} {isAttendingOrder.total?.toFixed(2)}</span>
                      </div>
                      {(isAttendingOrder.giftCard || 0) > 0 && (
                        <div className="flex justify-between text-red-600">
                          <span>Gift Card</span>
                          <span className="font-mono">-{currencySymbol} {isAttendingOrder.giftCard?.toFixed(2)}</span>
                        </div>
                      )}
                      {(isAttendingOrder.voucher || 0) > 0 && (
                        <div className="flex justify-between text-red-600">
                          <span>Voucher</span>
                          <span className="font-mono">-{currencySymbol} {isAttendingOrder.voucher?.toFixed(2)}</span>
                        </div>
                      )}
                      {(isAttendingOrder.tip || 0) > 0 && (
                        <div className="flex justify-between text-green-600">
                          <span>{settings.language === 'pt' ? 'Gorjeta' : 'Tip'}</span>
                          <span className="font-mono">+{currencySymbol} {isAttendingOrder.tip?.toFixed(2)}</span>
                        </div>
                      )}
                      {(isAttendingOrder.discount || 0) > 0 && (
                        <div className="flex justify-between text-red-600">
                          <span>{settings.language === 'pt' ? 'Desconto' : 'Discount'}</span>
                          <span className="font-mono">-{currencySymbol} {isAttendingOrder.discount?.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-bold pt-2 border-t border-black/5 text-black">
                        <span>Total Pago</span>
                        <span className="font-mono font-serif text-base text-black">
                          {currencySymbol} {(
                            (isAttendingOrder.total || 0) + 
                            (isAttendingOrder.tip || 0) - 
                            (isAttendingOrder.discount || 0) - 
                            (isAttendingOrder.giftCard || 0) - 
                            (isAttendingOrder.voucher || 0)
                          ).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {isAttendingOrder.paymentMethod && (
                      <div className="pt-2 border-t border-black/5 flex justify-between items-center text-xs text-black">
                        <span className="font-bold uppercase opacity-50">
                          {settings.language === 'pt' ? 'Método de Pagamento' : 'Payment Method'}
                        </span>
                        <span className="px-3 py-1 bg-black text-white font-bold rounded-lg uppercase tracking-wider text-[10px]">
                          {isAttendingOrder.paymentMethod}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Service Notes */}
                  {isAttendingOrder.formulaNotes && (
                    <div className="space-y-1 text-black">
                      <label className="text-[10px] font-bold uppercase opacity-40">Service Notes</label>
                      <div className="p-4 bg-white border rounded-2xl text-xs text-black/80 whitespace-pre-wrap">
                        {isAttendingOrder.formulaNotes}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="space-y-3 pt-4 border-t border-black/5">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await updateDoc(doc(db, 'pedidos', isAttendingOrder.id), {
                            status: 'pending'
                          });
                          setIsAttendingOrder({
                            ...isAttendingOrder,
                            status: 'pending'
                          });
                          setAttendingStep(1);
                          toast.success('Appointment reopened! You can now apply discounts and finalize.');
                        } catch (err) {
                          console.error("Error reopening appointment:", err);
                          toast.error('Error reopening appointment.');
                        }
                      }}
                      className="w-full py-4 rounded-2xl text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98]"
                      style={{ backgroundColor: settings.primaryColor }}
                    >
                      <RotateCcw size={16} />
                      REOPEN APPOINTMENT
                    </button>

                    <div className="flex gap-4 text-black">
                      <button
                        type="button"
                        onClick={() => { setIsAttendingOrder(null); setAttendingStep(1); }}
                        className="flex-1 py-4 border rounded-2xl font-bold transition-all hover:bg-black/5 text-black text-sm"
                      >
                        CLOSE
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmModal({
                            isOpen: true,
                            title: settings.language === 'pt' ? 'Excluir Agendamento' : 'Delete Appointment',
                            message: settings.language === 'pt' ? 'Tem certeza que deseja excluir permanentemente este agendamento finalizado?' : 'Are you sure you want to permanently delete this completed appointment?',
                            onConfirm: async () => {
                              try {
                                await deleteDoc(doc(db, 'pedidos', isAttendingOrder.id));
                                setIsAttendingOrder(null);
                                setAttendingStep(1);
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                toast.success(settings.language === 'pt' ? 'Agendamento excluído com sucesso!' : 'Appointment deleted successfully!');
                              } catch (err) {
                                toast.error('Error deleting appointment.');
                              }
                            }
                          });
                        }}
                        className="flex-1 py-4 rounded-2xl bg-red-600 hover:bg-red-700 transition-all text-white font-bold shadow-md text-sm text-center flex items-center justify-center gap-2"
                      >
                        <Trash2 size={16} />
                        {settings.language === 'pt' ? 'EXCLUIR AGENDAMENTO' : 'DELETE APPOINTMENT'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {attendingStep === 1 && (
                <div className="space-y-6">
                  <h4 className="text-xl font-bold border-b pb-2" style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20' }}>Step 1: Confirm Services</h4>
                  <div className="space-y-4">
                    {isAttendingOrder.items.map((item, idx) => {
                      if (orderProfessionalFilter !== 'all' && item.professionalId !== orderProfessionalFilter) {
                        return null;
                      }
                      return (
                        <div key={idx} className="flex justify-between items-center p-4 bg-white rounded-2xl border" style={{ borderColor: settings.primaryColor + '20' }}>
                          <div className="space-y-1">
                            <div className="font-bold" style={{ color: settings.primaryColor }}>{item.title}</div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase font-bold opacity-40 tracking-widest" style={{ color: settings.primaryColor }}>Unit Price:</span>
                              <div className="flex items-center gap-1">
                                <span className="text-sm opacity-60" style={{ color: settings.primaryColor }}>{currencySymbol}</span>
                                <input 
                                  type="text" 
                                  inputMode="decimal"
                                  className="w-24 p-1 border rounded text-sm font-bold outline-none focus:ring-1"
                                  style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '40', '--tw-ring-color': settings.primaryColor } as any}
                                  value={item.price}
                                  onChange={(e) => {
                                    const val = e.target.value.replace(',', '.');
                                    if (val === '' || !isNaN(Number(val))) {
                                      const newItems = [...isAttendingOrder.items];
                                      newItems[idx].price = val === '' ? 0 : parseFloat(val);
                                      const newTotal = newItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                                      setIsAttendingOrder({ ...isAttendingOrder, items: newItems, total: newTotal });
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button onClick={() => {
                              const newItems = [...isAttendingOrder.items];
                              if (newItems[idx].quantity > 1) {
                                newItems[idx].quantity--;
                                const newTotal = newItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                                setIsAttendingOrder({ ...isAttendingOrder, items: newItems, total: newTotal });
                              } else {
                                newItems.splice(idx, 1);
                                const newTotal = newItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                                setIsAttendingOrder({ ...isAttendingOrder, items: newItems, total: newTotal });
                              }
                            }} className="w-8 h-8 rounded-full border flex items-center justify-center" style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '40' }}>-</button>
                            <span className="font-bold" style={{ color: settings.primaryColor }}>{item.quantity}</span>
                            <button onClick={() => {
                              const newItems = [...isAttendingOrder.items];
                              newItems[idx].quantity++;
                              const newTotal = newItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                              setIsAttendingOrder({ ...isAttendingOrder, items: newItems, total: newTotal });
                            }} className="w-8 h-8 rounded-full border flex items-center justify-center" style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '40' }}>+</button>
                          </div>
                        </div>
                      );
                    })}

                    {isAttendingOrder.anamneseAnswers && Object.keys(isAttendingOrder.anamneseAnswers).length > 0 && (
                      <div className="p-4 bg-purple-50 border border-purple-100 rounded-2xl space-y-3">
                        <h5 className="font-bold text-xs uppercase opacity-60 flex items-center gap-2">
                          <ClipboardList size={14} className="text-purple-600" /> Anamnese Form Answers
                        </h5>
                        <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                          {Object.entries(isAttendingOrder.anamneseAnswers).map(([question, answer], i) => (
                            <div key={i} className="text-xs">
                              <p className="font-bold opacity-70 mb-0.5">{question}</p>
                              <p className="bg-white/80 p-2 rounded-xl border border-purple-100 shadow-sm italic leading-relaxed">{answer as string}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="p-4 border-2 border-dashed rounded-2xl space-y-2" style={{ borderColor: settings.primaryColor + '20' }}>
                      <label className="text-[10px] font-bold uppercase opacity-40 tracking-[0.2em]" style={{ color: settings.primaryColor }}>+ Add more services to this session</label>
                      <select 
                        className="w-full p-3 rounded-xl border bg-white outline-none"
                        style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20' }}
                        onChange={(e) => {
                          const prod = products.find(p => p.id === e.target.value);
                          if (prod) {
                            const newItems = [...isAttendingOrder.items];
                            const currentProf = professionals.find(p => p.id === orderProfessionalFilter);
                            newItems.push({
                              productId: prod.id,
                              title: prod.title,
                              price: prod.price,
                              quantity: 1,
                              department: prod.department,
                              professionalId: orderProfessionalFilter !== 'all' ? orderProfessionalFilter : undefined,
                              professionalName: (orderProfessionalFilter !== 'all' && currentProf) ? currentProf.name : undefined
                            });
                            const newTotal = newItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                            setIsAttendingOrder({ ...isAttendingOrder, items: newItems, total: newTotal });
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">Search Service...</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.title} ({currencySymbol} {p.price.toFixed(2)})</option>)}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase opacity-40">Service Notes</label>
                      <textarea 
                        className="w-full p-3 rounded-xl border focus:ring-1 outline-none" 
                        style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20', '--tw-ring-color': settings.primaryColor } as any}
                        rows={3} 
                        placeholder="Register service details, observations, or notes for this day..."
                        value={newFormula}
                        onChange={e => setNewFormula(e.target.value)}
                      />
                    </div>

                    {!showGiftVoucher ? (
                      <button 
                        onClick={() => setShowGiftVoucher(true)}
                        className="w-full py-4 border-2 border-dashed rounded-2xl font-bold text-sm transition-all"
                        style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '40' }}
                      >
                        + ADD GIFT CARD OR VOUCHER
                      </button>
                    ) : (
                      <div className="p-6 bg-white rounded-2xl border space-y-4" style={{ borderColor: settings.primaryColor + '20' }}>
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase opacity-60" style={{ color: settings.primaryColor }}>Gift Card [-]</label>
                          <div className="flex items-center gap-2">
                            <span className="font-bold" style={{ color: settings.primaryColor }}>{currencySymbol}</span>
                            <input 
                              type="text" 
                              inputMode="decimal"
                              className="w-24 p-2 rounded-lg border text-right font-bold outline-none focus:ring-1" 
                              style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '40', '--tw-ring-color': settings.primaryColor } as any}
                              value={isAttendingOrder.giftCard === 0 ? '' : isAttendingOrder.giftCard} 
                              onChange={e => {
                                const val = e.target.value.replace(',', '.');
                                if (val === '' || !isNaN(Number(val))) {
                                  setIsAttendingOrder({...isAttendingOrder, giftCard: val === '' ? 0 : parseFloat(val)});
                                }
                              }} 
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase opacity-60" style={{ color: settings.primaryColor }}>Voucher [-]</label>
                          <div className="flex items-center gap-2">
                            <span className="font-bold" style={{ color: settings.primaryColor }}>{currencySymbol}</span>
                            <input 
                              type="text" 
                              inputMode="decimal"
                              className="w-24 p-2 rounded-lg border text-right font-bold outline-none focus:ring-1" 
                              style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '40', '--tw-ring-color': settings.primaryColor } as any}
                              value={isAttendingOrder.voucher === 0 ? '' : isAttendingOrder.voucher} 
                              onChange={e => {
                                const val = e.target.value.replace(',', '.');
                                if (val === '' || !isNaN(Number(val))) {
                                  setIsAttendingOrder({...isAttendingOrder, voucher: val === '' ? 0 : parseFloat(val)});
                                }
                              }} 
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="pt-6 border-t space-y-2" style={{ borderColor: settings.primaryColor + '20' }}>
                      <div className="flex justify-between text-lg" style={{ color: settings.primaryColor }}>
                        <span>Subtotal</span>
                        <span>{currencySymbol} {sessionSubtotal.toFixed(2)}</span>
                      </div>
                      {(isAttendingOrder.giftCard || 0) > 0 && (
                        <div className="flex justify-between text-sm text-red-500">
                          <span>Gift Card</span>
                          <span>-{currencySymbol} {isAttendingOrder.giftCard?.toFixed(2)}</span>
                        </div>
                      )}
                      {(isAttendingOrder.voucher || 0) > 0 && (
                        <div className="flex justify-between text-sm text-red-500">
                          <span>Voucher</span>
                          <span>-{currencySymbol} {isAttendingOrder.voucher?.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-2xl font-bold pt-2" style={{ color: settings.primaryColor }}>
                        <span>Total Value</span>
                        <span>{currencySymbol} {(sessionSubtotal - (isAttendingOrder.giftCard || 0) - (isAttendingOrder.voucher || 0)).toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 w-full">
                      <button 
                        onClick={() => {
                          const isUSA = settings.whatsappCountryCode === '+1' && settings.currency === 'USD';
                          setAttendingStep(isUSA ? 2 : 3);
                        }} 
                        className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-xl hover:opacity-90 transition-opacity"
                        style={{ backgroundColor: settings.primaryColor }}
                      >
                        CONFIRM SERVICES (OK)
                      </button>

                      <button 
                        onClick={() => {
                          setAttendingStep(10);
                        }} 
                        className="w-full py-3 rounded-2xl text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2 border border-rose-100"
                      >
                        <UserX size={16} /> CLIENT NO-SHOW
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {attendingStep === 2 && (
                <div className="space-y-6">
                  <h4 className="text-xl font-bold border-b pb-2" style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20' }}>Step 2: Tip (Gratuity)</h4>
                  <div className="space-y-6">
                    <p className="text-center text-lg opacity-60" style={{ color: settings.primaryColor }}>Would you like to add a tip?</p>
                    <div className="max-w-xs mx-auto space-y-2">
                      <label className="text-xs font-bold uppercase opacity-60" style={{ color: settings.primaryColor }}>Tip / Gratuity</label>
                      <div className="flex items-center gap-2 border-b-2 pb-2" style={{ borderColor: settings.primaryColor }}>
                        <span className="text-2xl font-bold" style={{ color: settings.primaryColor }}>{currencySymbol}</span>
                        <input 
                          type="text" 
                          inputMode="decimal"
                          className="w-full bg-transparent text-3xl font-bold outline-none" 
                          style={{ color: settings.primaryColor }}
                          value={isAttendingOrder.tip === 0 ? '' : isAttendingOrder.tip} 
                          onChange={e => {
                            const val = e.target.value.replace(',', '.');
                            if (val === '' || !isNaN(Number(val))) {
                              setIsAttendingOrder({...isAttendingOrder, tip: val === '' ? 0 : parseFloat(val)});
                            }
                          }} 
                          placeholder="0.00" 
                        />
                      </div>
                    </div>
                    <div className="pt-6 border-t flex justify-between text-3xl font-bold" style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20' }}>
                      <span>Total Paid Amount</span>
                      <span>{currencySymbol} {(sessionSubtotal + (isAttendingOrder.tip || 0) - (isAttendingOrder.discount || 0) - (isAttendingOrder.giftCard || 0) - (isAttendingOrder.voucher || 0)).toFixed(2)}</span>
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => setAttendingStep(1)} className="flex-1 py-4 rounded-2xl font-bold text-lg border" style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20' }}>BACK</button>
                      <button 
                        onClick={() => setAttendingStep(3)} 
                        disabled={isAttendingOrder.tip === undefined}
                        className="flex-1 py-4 rounded-2xl text-white font-bold text-lg shadow-xl disabled:opacity-50"
                        style={{ backgroundColor: settings.primaryColor }}
                      >
                        NEXT
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {attendingStep === 3 && (
                <div className="space-y-6">
                  <h4 className="text-xl font-bold border-b pb-2" style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20' }}>Step 3: Payment Method</h4>
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      {(() => {
                        const isUSA = settings.whatsappCountryCode === '+1' && settings.currency === 'USD';
                        const methods = isUSA 
                          ? ['CASH', 'VENMO', 'ZELLE', 'PAYPAL', 'APPLE PAY'] 
                          : ['CASH', 'CARTÃO CRÉDITO', 'CARTÃO DÉBITO', 'PIX', 'PAYPAL'];
                        return methods.map(method => (
                          <button 
                            key={method} 
                            onClick={() => setIsAttendingOrder(prev => prev ? {...prev, paymentMethod: method} : null)} 
                            className={cn(
                              "p-6 rounded-2xl border-2 font-bold text-lg transition-all", 
                              isAttendingOrder?.paymentMethod === method ? "shadow-inner scale-95" : "hover:scale-105"
                            )}
                            style={{ 
                              backgroundColor: isAttendingOrder?.paymentMethod === method ? settings.primaryColor : 'white',
                              borderColor: settings.primaryColor + (isAttendingOrder?.paymentMethod === method ? '' : '20'),
                              color: isAttendingOrder?.paymentMethod === method ? '#ffffff' : '#000000'
                            }}
                          >
                            {method}
                          </button>
                        ));
                      })()}
                    </div>

                    <div className="p-4 bg-white rounded-3xl border flex flex-col items-center gap-4" style={{ borderColor: settings.primaryColor + '20' }}>
                      <h5 className="font-bold uppercase text-[10px] opacity-40 tracking-widest text-center" style={{ color: settings.primaryColor }}>
                        {isAttendingOrder?.paymentMethod ? `Selected Payment: ${isAttendingOrder.paymentMethod}` : 'Please select a payment method above'}
                      </h5>
                      
                      {isAttendingOrder?.paymentMethod && !['CASH', 'CREDIT CARD', 'DEBIT CARD', 'CARTÃO CRÉDITO', 'CARTÃO DÉBITO', 'APPLE PAY'].includes(isAttendingOrder.paymentMethod) && (
                        <div className="w-full flex flex-col items-center gap-3">
                          <div className="text-[10px] font-black uppercase opacity-60 bg-black/5 px-4 py-1 rounded-full">QR CODE FOR {isAttendingOrder.paymentMethod}</div>
                              {(() => {
                                const profId = isAttendingOrder.professionalId || isAttendingOrder.items?.[0]?.professionalId;
                                const prof = professionals.find(p => p.id === profId);
                                const activeQrs = (prof?.qrCodes || []).filter(q => q.image && q.label);
                                const methodStr = (isAttendingOrder.paymentMethod || '').toUpperCase().trim();
                                
                                // Precise match helper
                                const getIsMatch = (label: string, method: string) => {
                                  const l = label.toUpperCase().trim();
                                  const m = method.toUpperCase().trim();
                                  if (m === 'ZELLE') {
                                    return l.includes('ZELLE') || l.includes('ZEL');
                                  }
                                  if (m === 'VENMO') {
                                    return l.includes('VENMO');
                                  }
                                  if (m === 'PAYPAL') {
                                    return l.includes('PAYPAL') || l.includes('PAY-PAL') || l.includes('PAY PAL');
                                  }
                                  if (m === 'PIX') {
                                    return l.includes('PIX');
                                  }
                                  return l === m || l.includes(m) || m.includes(l);
                                };

                                const matchedQr = activeQrs.find(q => getIsMatch(q.label, methodStr));
                                
                                if (matchedQr) {
                                  return (
                                    <div className="flex flex-col items-center gap-2">
                                      <div className="text-[10px] font-black uppercase opacity-65 bg-black/10 px-4 py-1.5 rounded-full tracking-wider">
                                        Professional QR Code for {matchedQr.label}
                                      </div>
                                      <img src={matchedQr.image} className="w-64 h-64 sm:w-80 sm:h-80 object-contain shadow-2xl rounded-3xl border-4 border-white ring-1 ring-black/5 bg-white p-2" referrerPolicy="no-referrer" />
                                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full whitespace-nowrap">Professional Account: {prof?.name}</p>
                                      <p className="text-[9px] opacity-40 font-bold">This QR code was registered by your attending professional.</p>
                                    </div>
                                  );
                                }

                                // Fallback to individual professional fields or global setting fields
                                if (methodStr === 'ZELLE') {
                                  const zelleImg = prof?.zelleQR || settings.zelleQR;
                                  if (zelleImg) {
                                    return (
                                      <div className="flex flex-col items-center gap-2">
                                        <div className="text-[10px] font-black uppercase opacity-65 bg-black/10 px-4 py-1.5 rounded-full tracking-wider">
                                          ZELLE QR Code
                                        </div>
                                        <img src={zelleImg} className="w-64 h-64 sm:w-80 sm:h-80 object-contain shadow-2xl rounded-3xl border-4 border-white ring-1 ring-black/5 bg-white p-2" referrerPolicy="no-referrer" />
                                        <p className="text-[9px] opacity-40 font-bold">Scan the code above to send payment.</p>
                                      </div>
                                    );
                                  }
                                } else if (methodStr === 'VENMO' && settings.venmoQR) {
                                  return (
                                    <div className="flex flex-col items-center gap-2">
                                      <div className="text-[10px] font-black uppercase opacity-65 bg-black/10 px-4 py-1.5 rounded-full tracking-wider">
                                        VENMO QR Code
                                      </div>
                                      <img src={settings.venmoQR} className="w-64 h-64 sm:w-80 sm:h-80 object-contain shadow-2xl rounded-3xl border-4 border-white ring-1 ring-black/5 bg-white p-2" referrerPolicy="no-referrer" />
                                      <p className="text-[9px] opacity-40 font-bold">Scan the code above to send payment.</p>
                                    </div>
                                  );
                                } else if (methodStr === 'PAYPAL' && settings.paypalQR) {
                                  return (
                                    <div className="flex flex-col items-center gap-2">
                                      <div className="text-[10px] font-black uppercase opacity-65 bg-black/10 px-4 py-1.5 rounded-full tracking-wider">
                                        PAYPAL QR Code
                                      </div>
                                      <img src={settings.paypalQR} className="w-64 h-64 sm:w-80 sm:h-80 object-contain shadow-2xl rounded-3xl border-4 border-white ring-1 ring-black/5 bg-white p-2" referrerPolicy="no-referrer" />
                                      <p className="text-[9px] opacity-40 font-bold">Scan the code above to send payment.</p>
                                    </div>
                                  );
                                } else if (methodStr === 'PIX' && settings.pixQR) {
                                  return (
                                    <div className="flex flex-col items-center gap-2">
                                      <div className="text-[10px] font-black uppercase opacity-65 bg-black/10 px-4 py-1.5 rounded-full tracking-wider">
                                        PIX QR Code
                                      </div>
                                      <img src={settings.pixQR} className="w-64 h-64 sm:w-80 sm:h-80 object-contain shadow-2xl rounded-3xl border-4 border-white ring-1 ring-black/5 bg-white p-2" referrerPolicy="no-referrer" />
                                      <p className="text-[9px] opacity-40 font-bold">Scan the code above to send payment.</p>
                                    </div>
                                  );
                                }

                                // No match found
                                return (
                                  <div className="p-10 bg-black/5 rounded-3xl text-center space-y-2 border-2 border-dashed border-black/10 w-full font-sans">
                                    <div className="text-sm font-black opacity-60">
                                      {settings.language === 'pt' ? 'QR Code não cadastrado' : 'QR Code not registered'}
                                    </div>
                                    <p className="text-[10px] opacity-40 max-w-[200px] font-bold mx-auto">
                                      {settings.language === 'pt'
                                        ? `A profissional ${prof?.name || ''} não cadastrou o QR Code do ${isAttendingOrder.paymentMethod} no painel.`
                                        : `Professional ${prof?.name || ''} has not registered a QR Code for ${isAttendingOrder.paymentMethod}.`}
                                    </p>
                                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full inline-block whitespace-nowrap mt-2">Professional Account: {prof?.name}</p>
                                  </div>
                                );
                              })()}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          const isUSA = settings.whatsappCountryCode === '+1' && settings.currency === 'USD';
                          setAttendingStep(isUSA ? 2 : 1);
                        }} 
                        className="flex-1 py-4 rounded-2xl font-bold text-lg border"
                        style={{ color: settings.primaryColor, borderColor: settings.primaryColor + '20' }}
                      >
                        BACK
                      </button>
                      <button 
                        onClick={async () => {
                          if (isSaving) return;
                          if (!isAttendingOrder?.id) {
                            toast.error('Error: Appointment ID not found.');
                            return;
                          }
                          setIsSaving(true);
                          try {
                            const updatedItems = isAttendingOrder.items.map(item => {
                              if (orderProfessionalFilter === 'all' || item.professionalId === orderProfessionalFilter) {
                                return { ...item, status: 'completed' as const };
                              }
                              return item;
                            });

                            const allCompleted = updatedItems.every(i => i.status === 'completed');
                            const orderStatus = allCompleted ? 'completed' : 'pending';

                            const finalTotal = updatedItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                            const sessionTotalPaid = sessionSubtotal + (isAttendingOrder.tip || 0) - (isAttendingOrder.discount || 0) - (isAttendingOrder.giftCard || 0) - (isAttendingOrder.voucher || 0);
                            
                            // Remove id and any undefined fields from payload
                            const { id: orderId, ...updateData } = isAttendingOrder;
                            const cleanUpdateData = Object.fromEntries(
                              Object.entries(updateData).filter(([k, v]) => v !== undefined && typeof v !== 'function')
                            );

                            await updateDoc(doc(db, 'pedidos', isAttendingOrder.id), {
                              ...cleanUpdateData,
                              items: updatedItems,
                              status: orderStatus,
                              total: Math.max(0, sessionTotalPaid),
                              formulaNotes: newFormula || ''
                            });

                            // Save formula to customer history
                            if (newFormula) {
                              const record = customerRecords.find(r => r.phone === isAttendingOrder.phone);
                              
                              const newEntry = {
                                date: new Date().toISOString(),
                                text: `[Service Note] ${newFormula}`,
                                photos: []
                              };
                              
                              if (record) {
                                const updatedFormulas = [newEntry, ...(record.formulas || [])];
                                await updateDoc(doc(db, 'clientes_historico', record.id), { 
                                  formulas: updatedFormulas 
                                });
                              } else {
                                await addDoc(collection(db, 'clientes_historico'), {
                                  name: isAttendingOrder.customerName,
                                  phone: isAttendingOrder.phone,
                                  email: isAttendingOrder.email || '',
                                  formulas: [newEntry],
                                  notes: ''
                                });
                              }
                            }
                            
                            setNewFormula('');
                            const lang = isAttendingOrder.orderLanguage || settings.language || 'en';
                            const msgs = {
                              en: {
                                title: 'APPOINTMENT SUMMARY',
                                hello: 'Hello',
                                summary: 'Summary of your appointment:',
                                subtotal: 'Subtotal',
                                tip: 'Tip / Gratuity',
                                discount: 'Discount',
                                giftCard: 'Gift Card',
                                voucher: 'Voucher',
                                total: 'Total Paid',
                                method: 'Payment Method',
                                thanks: '_Thank you for visiting His & Hers Waxing Studio! 🌹_\n_See you at your next appointment, Nathalia_'
                              }
                            };
                            const m = msgs[lang as keyof typeof msgs] || msgs.en;
                            
                            const thanksMessage = settings.whatsappPostAtendimentoMessage || m.thanks;

                            const message = `${m.hello} *${isAttendingOrder.customerName}*\n` +
                              `${m.summary}\n` +
                              sessionItems.map(i => `• ${i.title} : ${currencySymbol} ${(i.price * i.quantity).toFixed(2)}`).join('\n') +
                              (isAttendingOrder.tip ? `\n*${m.tip}:* ${currencySymbol} ${isAttendingOrder.tip.toFixed(2)}` : '') +
                              (isAttendingOrder.discount ? `\n*${m.discount}:* -${currencySymbol} ${isAttendingOrder.discount.toFixed(2)}` : '') +
                              (isAttendingOrder.giftCard ? `\n*${m.giftCard}:* -${currencySymbol} ${isAttendingOrder.giftCard.toFixed(2)}` : '') +
                              (isAttendingOrder.voucher ? `\n*${m.voucher}:* -${currencySymbol} ${isAttendingOrder.voucher.toFixed(2)}` : '') +
                              `\n*${m.total}: ${currencySymbol} ${sessionTotalPaid.toFixed(2)}*` +
                              `\n\n${thanksMessage}`;
                            
                            const countryCodeRaw = settings.whatsappCountryCode?.replace(/\D/g, '') || '1';
                            let cleanPhone = isAttendingOrder.phone.replace(/\D/g, '');
                            if (cleanPhone.startsWith(countryCodeRaw)) {
                              cleanPhone = cleanPhone.slice(countryCodeRaw.length);
                            }
                            
                            const encodedMessage = encodeURIComponent(message);
                            const whatsappUrl = `https://wa.me/${countryCodeRaw}${cleanPhone}?text=${encodedMessage}`;
                            const smsUrl = `sms:${countryCodeRaw}${cleanPhone}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodedMessage}`;
                            
                            setOrderFinalizedAction({
                              message,
                              whatsappUrl,
                              smsUrl,
                              customerName: isAttendingOrder.customerName
                            });
                            
                            setIsAttendingOrder(null);
                            setAttendingStep(1);
                            setShowGiftVoucher(false);
                            toast.success('Service finalized successfully!');
                          } catch (err) {
                            console.error("Finalize error:", err);
                            toast.error('Error finalizing appointment.');
                          } finally {
                            setIsSaving(false);
                          }
                        }} 
                        disabled={!isAttendingOrder?.paymentMethod || isSaving} 
                        className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-xl disabled:opacity-50"
                        style={{ backgroundColor: settings.primaryColor }}
                      >
                        FINALIZE SESSION
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {attendingStep === 10 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 border-b pb-3 border-rose-100">
                    <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                      <UserX size={24} />
                    </div>
                    <div>
                      <h4 className="text-xl font-serif font-black text-rose-600">Client No-Show</h4>
                      <p className="text-xs opacity-60">Process missed appointment and apply booking fee</p>
                    </div>
                  </div>

                  <div className="bg-rose-50/50 p-4 rounded-2xl border border-rose-100 text-xs text-rose-800 leading-relaxed space-y-2">
                    <p className="font-bold">⚠️ IMPORTANT POLICY ACTION:</p>
                    <p>Marking this appointment as a **No-Show** will release the calendar slot as free time and set the booking status to **No-Show** in history.</p>
                    <p>This action will prepare a customizable message with Zelle instructions to send to the client.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase opacity-60">Penalty Fee ({currencySymbol})</label>
                      <input 
                        type="text" 
                        inputMode="decimal"
                        className="w-full p-3 rounded-xl border border-gray-300 font-bold bg-white text-black" 
                        value={noShowCustomFee} 
                        onChange={e => {
                          const val = e.target.value.replace(',', '.');
                          if (val === '' || !isNaN(Number(val))) {
                            setNoShowCustomFee(val);
                          }
                        }}
                        placeholder="0.00" 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase opacity-60">Transfer Details (Zelle)</label>
                      <input 
                        type="text" 
                        className="w-full p-3 rounded-xl border border-gray-300 font-medium bg-white text-black" 
                        value={noShowCustomInstructions} 
                        onChange={e => setNoShowCustomInstructions(e.target.value)}
                        placeholder="Zelle email or phone" 
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold uppercase opacity-60">Message Preview</label>
                      <span className="text-[10px] font-black uppercase tracking-widest text-green-600">WhatsApp / SMS Ready</span>
                    </div>
                    <div className="bg-gray-50 border p-4 rounded-2xl text-xs font-mono text-gray-700 whitespace-pre-wrap leading-relaxed shadow-inner">
                      {(settings.noShowMessageTemplate || 'Hello {nome}! 👋 This is {marca}. You missed your scheduled appointment. As per our policy, a no-show fee of {fee} is applied. Please send the payment of {fee} via Zelle to {payment_info}. Thank you for your cooperation! ✨')
                        .replace(/{nome}/g, isAttendingOrder.customerName)
                        .replace(/{marca}/g, settings.brandName || 'Easy Beauty')
                        .replace(/{fee}/g, `${currencySymbol}${noShowCustomFee || '0.00'}`)
                        .replace(/{payment_info}/g, noShowCustomInstructions || 'the registered account')
                      }
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-black/5">
                    <button 
                      type="button"
                      onClick={() => setAttendingStep(1)}
                      className="flex-1 py-3.5 bg-gray-100 hover:bg-gray-200 text-black font-bold rounded-2xl text-sm transition-all"
                    >
                      GO BACK
                    </button>
                    <button 
                      type="button"
                      onClick={async () => {
                        if (isSaving) return;
                        setIsSaving(true);
                        try {
                          // 1. Mark order items as cancelled or no-show
                          const updatedItems = isAttendingOrder.items.map(item => {
                            return { ...item, status: 'no-show' as any };
                          });

                          // 2. Format the custom no-show message
                          const rawMsg = settings.noShowMessageTemplate || 'Hello {nome}! 👋 This is {marca}. You missed your scheduled appointment. As per our policy, a no-show fee of {fee} is applied. Please send the payment of {fee} via Zelle to {payment_info}. Thank you for your cooperation! ✨';
                          const message = rawMsg
                            .replace(/{nome}/g, isAttendingOrder.customerName)
                            .replace(/{marca}/g, settings.brandName || 'Easy Beauty')
                            .replace(/{fee}/g, `${currencySymbol}${noShowCustomFee || '0.00'}`)
                            .replace(/{payment_info}/g, noShowCustomInstructions || 'the registered account');

                          // 3. Update the order document in Firestore
                          await updateDoc(doc(db, 'pedidos', isAttendingOrder.id), {
                            status: 'no-show',
                            items: updatedItems,
                            noShowFeeCharged: parseFloat(noShowCustomFee) || 0,
                            noShowMessageSent: message
                          });

                          // 4. Generate messaging links
                          const countryCodeRaw = settings.whatsappCountryCode?.replace(/\D/g, '') || '1';
                          let cleanPhone = isAttendingOrder.phone.replace(/\D/g, '');
                          if (cleanPhone.startsWith(countryCodeRaw)) {
                            cleanPhone = cleanPhone.slice(countryCodeRaw.length);
                          }
                          
                          const encodedMessage = encodeURIComponent(message);
                          const whatsappUrl = `https://wa.me/${countryCodeRaw}${cleanPhone}?text=${encodedMessage}`;
                          const smsUrl = `sms:${countryCodeRaw}${cleanPhone}${window.navigator.userAgent.match(/iPhone/i) ? '&' : '?'}body=${encodedMessage}`;

                          setOrderFinalizedAction({
                            message,
                            whatsappUrl,
                            smsUrl,
                            customerName: isAttendingOrder.customerName
                          });

                          setIsAttendingOrder(null);
                          setAttendingStep(1);
                          toast.success('No-Show finalized! Please send the reminder.');
                        } catch (err) {
                          console.error("No-Show processing error:", err);
                          toast.error('Error processing No-Show.');
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                      disabled={isSaving}
                      className="flex-1 py-3.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-2xl text-sm shadow-md transition-all flex items-center justify-center gap-2"
                    >
                      {isSaving ? <Loader2 className="animate-spin" size={16} /> : <UserX size={16} />} FINALIZE & SEND FEE
                    </button>
                  </div>
                </div>
              )}
                </>
              )}
            </div>
          </div>
        )}
        {/* Modal Abrir Vaga Extras (Profissional) */}
        {isOpeningSlot && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Calendar size={20} style={{ color: settings.primaryColor }} />
                  Open Extra Slots
                </h3>
                <button onClick={() => { setIsOpeningSlot(false); setOpeningSlotProfId(null); }} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold opacity-60 uppercase">Slot Date</label>
                  <input 
                    type="date" 
                    className="w-full p-3 rounded-xl border-2 border-gray-100 focus:border-[#865d39] outline-none transition-all"
                    value={newExtraSlot.date || ''}
                    onChange={e => setNewExtraSlot({...newExtraSlot, date: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold opacity-60 uppercase">Start</label>
                  <input 
                    type="time" 
                    className="w-full p-3 rounded-xl border-2 border-gray-100 focus:border-[#865d39] outline-none transition-all"
                    value={newExtraSlot.start || ''}
                    onChange={e => setNewExtraSlot({...newExtraSlot, start: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold opacity-60 uppercase">End</label>
                  <input 
                    type="time" 
                    className="w-full p-3 rounded-xl border-2 border-gray-100 focus:border-[#865d39] outline-none transition-all"
                    value={newExtraSlot.end || ''}
                    onChange={e => setNewExtraSlot({...newExtraSlot, end: e.target.value})}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => { setIsOpeningSlot(false); setOpeningSlotProfId(null); }}
                  className="flex-1 py-3 rounded-xl font-bold border-2 border-gray-100 hover:bg-gray-50 transition-all text-black"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    if (newExtraSlot.date && newExtraSlot.start && newExtraSlot.end) {
                      try {
                        const dateParts = newExtraSlot.date.split('-');
                        const formattedDate = `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`;
                        
                        await addDoc(collection(db, 'horarios_extras'), {
                          profId: openingSlotProfId,
                          date: formattedDate,
                          start: newExtraSlot.start,
                          end: newExtraSlot.end,
                          createdAt: serverTimestamp()
                        });
                        
                        toast.success('Extra slot opened successfully!');
                        setIsOpeningSlot(false);
                        setOpeningSlotProfId(null);
                        setNewExtraSlot({
                          date: new Date().toISOString().split('T')[0],
                          start: '',
                          end: ''
                        });
                      } catch (err) {
                        toast.error('Error opening slot');
                      }
                    } else {
                      toast.error('Please fill in all fields');
                    }
                  }}
                  className="flex-[2] py-3 rounded-xl font-bold text-white shadow-lg active:scale-95 transition-all"
                  style={{ backgroundColor: settings?.primaryColor || '#865d39' }}
                >
                  Confirm Slot
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {isOpeningGap && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Calendar size={20} style={{ color: settings.primaryColor }} />
                  Open Extra Slots
                </h3>
                <button onClick={() => setIsOpeningGap(null)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold opacity-60 uppercase">Start</label>
                  <input 
                    type="time" 
                    className="w-full p-3 rounded-xl border-2 border-gray-100 focus:border-[#865d39] outline-none transition-all"
                    value={gapInput.start}
                    onChange={e => setGapInput({...gapInput, start: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold opacity-60 uppercase">End</label>
                  <input 
                    type="time" 
                    className="w-full p-3 rounded-xl border-2 border-gray-100 focus:border-[#865d39] outline-none transition-all"
                    value={gapInput.end}
                    onChange={e => setGapInput({...gapInput, end: e.target.value})}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsOpeningGap(null)}
                  className="flex-1 py-3 rounded-xl font-bold border-2 border-gray-100 hover:bg-gray-50 transition-all text-black"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    if (gapInput.start && gapInput.end) {
                      try {
                        const orderRef = doc(db, 'pedidos', isOpeningGap.id);
                        await updateDoc(orderRef, { 
                          gapStart: gapInput.start, 
                          gapEnd: gapInput.end 
                        });

                        const profId = isOpeningGap.items?.[0]?.professionalId;
                        if (profId) {
                          const dateParts = (isOpeningGap.appointmentDate || '').split('-');
                          const formattedDate = dateParts.length === 3 
                            ? `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`
                            : isOpeningGap.appointmentDate;

                          await addDoc(collection(db, 'horarios_extras'), {
                            profId: profId,
                            date: formattedDate,
                            start: gapInput.start,
                            end: gapInput.end,
                            orderId: isOpeningGap.id,
                            createdAt: serverTimestamp()
                          });
                        }

                        toast.success('Slot opened successfully!');
                        setIsOpeningGap(null);
                      } catch (err) {
                        console.error("Error opening gap:", err);
                        toast.error('Error opening slot');
                      }
                    } else {
                      toast.error('Fill in both times');
                    }
                  }}
                  className="flex-[2] py-3 rounded-xl font-bold shadow-lg active:scale-95 transition-all"
                  style={{ backgroundColor: settings?.primaryColor || '#865d39', color: getContrastColor(settings?.primaryColor || '#865d39') }}
                >
                  Confirm Slot
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {selectedBlockDetail && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedBlockDetail(null)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white p-6 sm:p-8 rounded-[2.5rem] w-full max-w-md shadow-2xl border border-black/5 space-y-6 text-black"
            >
              <div className="flex justify-between items-center pb-2 border-b">
                <h3 className="text-xl font-serif font-black flex items-center gap-2 text-red-700 uppercase tracking-wide">
                  <CalendarOff size={22} className="text-red-600 animate-pulse" />
                  {settings.language === 'pt' ? 'Bloqueio' : 'Blocked'}
                </h3>
                <button 
                  onClick={() => setSelectedBlockDetail(null)} 
                  className="p-1 hover:bg-black/5 rounded-full transition-colors text-black"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-black">
                  <h4 className="text-sm font-black text-red-900 mb-1">
                    {selectedBlockDetail.title || (settings.language === 'pt' ? 'Período Bloqueado' : 'Blocked Period')}
                  </h4>
                  {selectedBlockDetail.notes ? (
                    <p className="text-xs text-gray-700 font-semibold whitespace-pre-wrap bg-white p-3 rounded-xl border border-red-100/50 shadow-inner mt-2">
                      {selectedBlockDetail.notes}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic mt-1">
                      {settings.language === 'pt' ? 'Sem observações adicionais.' : 'No notes provided.'}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs font-bold uppercase opacity-80 text-black">
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <span className="block text-[10px] text-gray-400 mb-1">Professional</span>
                    <span className="text-sm font-black text-black">{selectedBlockDetail.profName}</span>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 font-mono">
                    <span className="block text-[10px] text-gray-400 mb-1">Hours</span>
                    <span className="text-sm font-black text-black">{selectedBlockDetail.startTime} - {selectedBlockDetail.endTime}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                {selectedBlockDetail.originalBlock && (
                  <button
                    onClick={() => {
                      const msg = settings.language === 'pt'
                        ? 'Tem certeza que deseja excluir permanentemente este bloqueio de horário?'
                        : 'Are you sure you want to permanently delete this time block?';
                      
                      setConfirmModal({
                        isOpen: true,
                        title: settings.language === 'pt' ? 'Excluir Bloqueio' : 'Delete Block',
                        message: msg,
                        onConfirm: async () => {
                          try {
                            const currentHolidays = settings.holidays || [];
                            const newHolidays = currentHolidays.filter((h: any) => {
                              if (typeof h === 'string') return true;
                              const isMatch = h.date === selectedBlockDetail.originalBlock.date &&
                                              h.startTime === selectedBlockDetail.originalBlock.startTime &&
                                              h.endTime === selectedBlockDetail.originalBlock.endTime &&
                                              (h.notes || '') === (selectedBlockDetail.originalBlock.notes || '') &&
                                              h.professionalId === selectedBlockDetail.originalBlock.professionalId;
                              return !isMatch;
                            });

                            await saveHolidaysToFirestore(newHolidays);
                            toast.success(settings.language === 'pt' ? 'Bloqueio removido com sucesso!' : 'Block removed successfully!');
                            setSelectedBlockDetail(null);
                            setConfirmModal(prev => ({ ...prev, isOpen: false }));
                          } catch (err: any) {
                            console.error("Error removing block:", err);
                            toast.error(`${settings.language === 'pt' ? 'Erro ao remover' : 'Error removing'}${err?.message ? `: ${err.message}` : ''}`);
                          }
                        }
                      });
                    }}
                    className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-lg active:scale-95 transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-1.5"
                  >
                    <Trash2 size={14} />
                    {settings.language === 'pt' ? 'Excluir' : 'Delete'}
                  </button>
                )}
                <button
                  onClick={() => setSelectedBlockDetail(null)}
                  className="flex-1 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-lg active:scale-95 transition-all text-xs uppercase tracking-wider hover:bg-black"
                >
                  {settings.language === 'pt' ? 'Fechar' : 'Close'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {isBlockingModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-white p-6 sm:p-8 rounded-[2.5rem] w-full max-w-md shadow-2xl border border-black/5 space-y-6"
            >
              <div className="flex justify-between items-center pb-2 border-b">
                <h3 className="text-xl font-serif font-black flex items-center gap-2">
                  <CalendarOff size={22} className="text-red-500" />
                  Block Period
                </h3>
                <button 
                  onClick={() => setIsBlockingModalOpen(false)} 
                  className="p-1 hover:bg-black/5 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase opacity-60">Professional</label>
                  <select 
                    className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-1 focus:ring-black bg-white font-bold"
                    value={blockingProfId}
                    onChange={e => setBlockingProfId(e.target.value)}
                  >
                    <option value="all">Whole Team</option>
                    {professionals.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase opacity-60">Day</label>
                  <input 
                    type="date"
                    required
                    className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-1 focus:ring-black font-bold"
                    value={blockingDate}
                    onChange={e => setBlockingDate(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase opacity-60">Start Time</label>
                    <select 
                      required
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-1 focus:ring-black font-bold bg-white text-sm"
                      value={blockingStartTime}
                      onChange={e => setBlockingStartTime(e.target.value)}
                    >
                      <option value="">Select start...</option>
                      {Array.from({ length: 19 * 4 }, (_, index) => {
                        const h = 5 + Math.floor(index / 4);
                        const m = (index % 4) * 15;
                        const hh = String(h).padStart(2, '0');
                        const mm = String(m).padStart(2, '0');
                        const timeVal = `${hh}:${mm}`;
                        const ampm = h >= 12 ? 'PM' : 'AM';
                        const displayHour = h % 12 === 0 ? 12 : h % 12;
                        const displayLabel = `${String(displayHour).padStart(2, '0')}:${mm} ${ampm}`;
                        return (
                          <option key={timeVal} value={timeVal}>{displayLabel}</option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase opacity-60">End Time</label>
                    <select 
                      required
                      className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-1 focus:ring-black font-bold bg-white text-sm"
                      value={blockingEndTime}
                      onChange={e => setBlockingEndTime(e.target.value)}
                    >
                      <option value="">Select end...</option>
                      {Array.from({ length: 19 * 4 }, (_, index) => {
                        const h = 5 + Math.floor(index / 4);
                        const m = (index % 4) * 15;
                        const hh = String(h).padStart(2, '0');
                        const mm = String(m).padStart(2, '0');
                        const timeVal = `${hh}:${mm}`;
                        const ampm = h >= 12 ? 'PM' : 'AM';
                        const displayHour = h % 12 === 0 ? 12 : h % 12;
                        const displayLabel = `${String(displayHour).padStart(2, '0')}:${mm} ${ampm}`;
                        return (
                          <option key={timeVal} value={timeVal}>{displayLabel}</option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase opacity-60">Notes / Observation (Optional)</label>
                  <textarea 
                    className="w-full p-3 rounded-xl border border-gray-200 outline-none focus:ring-1 focus:ring-black font-medium text-sm"
                    rows={2}
                    placeholder="Ex: Dentist appointment, lunch break, etc."
                    value={blockingNotes}
                    onChange={e => setBlockingNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setIsBlockingModalOpen(false)}
                  className="flex-1 py-3 rounded-xl font-bold border border-gray-200 hover:bg-gray-50 transition-all text-xs uppercase cursor-pointer text-black"
                >
                  Cancel
                </button>
                <button 
                  onClick={async () => {
                    if (!blockingDate || !blockingStartTime || !blockingEndTime) {
                      toast.error('Please fill in some day, start time, and end time');
                      return;
                    }
                    if (blockingStartTime >= blockingEndTime) {
                      toast.error('Start time must be before end time');
                      return;
                    }

                    const hObj: Holiday = {
                      date: blockingDate,
                      departments: ['all'],
                      startTime: blockingStartTime,
                      endTime: blockingEndTime,
                      notes: blockingNotes || ''
                    };

                    if (blockingProfId !== 'all') {
                      hObj.professionalId = blockingProfId;
                    }

                    try {
                      const currentHolidays = settings.holidays || [];
                      await saveHolidaysToFirestore([...currentHolidays, hObj]);
                      toast.success('Period blocked successfully!');
                      setIsBlockingModalOpen(false);
                    } catch (err: any) {
                      console.error("Error creating block:", err);
                      toast.error(`Error blocking period${err?.message ? `: ${err.message}` : ''}`);
                    }
                  }}
                  className="flex-[2] py-3 rounded-xl font-bold text-xs uppercase text-white bg-red-600 hover:bg-red-700 transition-all shadow-lg active:scale-95"
                >
                  Block Period
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {orderFinalizedAction && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-white/90 backdrop-blur-xl rounded-[40px] w-full max-w-sm overflow-hidden shadow-2xl border border-white/20"
              style={{ '--text-color': '#111827', color: '#111827' } as React.CSSProperties}
            >
              <div className="p-8 text-center space-y-6">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={40} />
                </div>
                <h2 className="text-2xl font-serif font-bold text-black leading-tight">
                  {settings.language === 'pt' ? 'Atendimento Finalizado!' : 'Session Completed!'}
                </h2>
                <p className="text-gray-600 max-w-sm mx-auto text-sm leading-relaxed font-bold">
                  {settings.language === 'pt' 
                    ? `O agendamento de ${orderFinalizedAction.customerName} foi concluído com sucesso.` 
                    : `Appointment for ${orderFinalizedAction.customerName} has been successfully completed.`}
                </p>

                <div className="space-y-3 pt-6">
                  <a 
                    href={orderFinalizedAction.whatsappUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-4 rounded-2xl text-white font-bold text-sm bg-green-500 shadow-xl shadow-green-500/10 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <MessageCircle size={18} fill="currentColor" /> {settings.language === 'pt' ? 'Enviar via WhatsApp' : 'Send via WhatsApp'}
                  </a>
                  <a 
                    href={orderFinalizedAction.smsUrl}
                    className="w-full py-4 rounded-2xl text-white font-bold text-sm bg-blue-500 shadow-xl shadow-blue-500/10 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <MessageSquare size={18} /> {settings.language === 'pt' ? 'Enviar via SMS' : 'Send via SMS'}
                  </a>
                  <button 
                    onClick={() => setOrderFinalizedAction(null)}
                    className="w-full py-4 rounded-2xl text-white font-bold text-lg shadow-xl shadow-black/10 hover:scale-[1.02] active:scale-95 transition-all"
                    style={{ backgroundColor: settings.primaryColor }}
                  >
                    {settings.language === 'pt' ? 'Concluir' : 'Finish'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
}
