import React, { useState, useEffect } from 'react';
import Menu from './components/Menu';
import Admin from './components/Admin';
import Footer from './components/Footer';
import { db } from './firebase';
import { doc, onSnapshot, setDoc, getDocs, collection, query, where, addDoc, serverTimestamp } from 'firebase/firestore';
import { Settings } from './types';
import { Toaster, toast } from 'sonner';

import { DEFAULT_LOGO, DEFAULT_BACKGROUND, INITIAL_PRODUCTS, INITIAL_CATEGORIES } from './constants';

export default function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    logo: DEFAULT_LOGO,
    primaryColor: '#865d39',
    whatsappNumber: '',
    whatsappCountryCode: '+1',
    slug: 'easy-beauty',
    brandName: 'CRIS GASPARRE',
    slogan: 'Estética Avançada',
    welcomeSlogan: 'Escolha sua experiência',
    hairSlogan: 'Define your style',
    makeupSlogan: 'Enhance your beauty',
    nailsSlogan: 'Perfect your touch',
    spaSlogan: 'Relax and rejuvenate',
    clinicSlogan: 'Professional care for you',
    aestheticSlogan: 'Advanced beauty treatments',
    whatsappClosingMessage: 'Your moment of care is almost set. Thank you for choosing Easy Beauty. Please wait while we review your request—we’ll reach out soon for the final confirmation.',
    whatsappPostAtendimentoMessage: 'Thank you for choosing us! We hope you loved your experience. See you soon!',
    backgroundImage: DEFAULT_BACKGROUND,
    glassColor: 'rgba(255, 255, 255, 0.4)',
    showHair: true,
    showMakeup: true,
    showNails: true,
    showSpa: false,
    showClinic: false,
    showAesthetic: false,
    textColor: '#000000',
    language: 'en',
    currency: 'USD',
    checkoutTitle: 'Just one last step',
    infoBlock1Title: 'Your data is safe with us. We use this info',
    infoBlock2Title: 'Almost there! After filling this out, our team',
    noShowFee: 25,
    noShowMessageTemplate: 'Hello {nome}! 👋 This is {marca}. You missed your scheduled appointment. As per our policy, a no-show fee of {fee} is applied. Please send the payment of {fee} via Zelle to {payment_info}. Thank you for your cooperation! ✨',
    noShowPaymentInstructions: 'hisandherswaxingstudio@gmail.com'
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleNavigation = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path === '/admin' || hash === '#/admin' || hash === '#admin') {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    };

    handleNavigation();
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);

    // Timeout de 10 segundos para o loading
    const loadingTimeout = setTimeout(() => {
      if (loading) {
        console.warn("Loading timeout: Firebase connection taking too long.");
        setLoading(false);
      }
    }, 10000);

    const unsub = onSnapshot(doc(db, 'configuracoes', 'geral'), async (docSnap) => {
      clearTimeout(loadingTimeout);
      let data: Settings | null = null;
      
      if (docSnap.exists()) {
        data = docSnap.data() as Settings;
      } else {
        // Fallback para tentar recuperar configurações da coleção antiga 'settings'
        try {
          const oldDoc = await getDocs(query(collection(db, 'settings')));
          if (!oldDoc.empty) {
            data = oldDoc.docs[0].data() as Settings;
            // Se encontrar na antiga, salva na nova para migrar
            await setDoc(doc(db, 'configuracoes', 'geral'), data);
          }
        } catch (e) {
          console.error("Erro ao tentar fallback de configurações:", e);
        }
      }

      if (data) {
        setSettings(data);
        setLoading(false);

        if (data.brandName) {
          document.title = data.brandName;
        }

        const themeColorMeta = document.getElementById('theme-color');
        if (themeColorMeta) {
          themeColorMeta.setAttribute('content', data.primaryColor || '#865d39');
        }

        const glassColor = data.glassColor || 'rgba(255, 255, 255, 0.4)';
        const finalGlassColor = (glassColor.startsWith('#') && glassColor.length === 7) 
          ? `${glassColor}66` 
          : glassColor;
        document.documentElement.style.setProperty('--glass-color', finalGlassColor);

        if (data.textColor) {
          document.documentElement.style.setProperty('--text-color', data.textColor);
        }
      } else {
        setLoading(false);
      }
    }, (error) => {
      console.error("Erro na conexão com Firebase:", error);
      clearTimeout(loadingTimeout);
      setLoading(false);
      toast.error("Erro ao conectar ao banco de dados. Verifique suas regras e internet.");
    });

    return () => {
      unsub();
      clearTimeout(loadingTimeout);
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('hashchange', handleNavigation);
    };
  }, []);

  useEffect(() => {
    const seedTestData = async () => {
      const isSeeded = localStorage.getItem('easyBeauty_seeded_v2');
      if (isSeeded) return;

      try {
        console.log("Seeding test data...");
        const catRefs: { [key: string]: string } = {};
        const demoCats = [
          { title: 'Estética Facial', dept: 'aesthetic' },
          { title: 'Cabelo & Cor', dept: 'hair' },
          { title: 'Manicure & Pedicure', dept: 'nails' },
          { title: 'Maquiagem Profissional', dept: 'makeup' },
          { title: 'Massagem & Relaxamento', dept: 'spa' }
        ];

        for (const cat of demoCats) {
          const catQuery = query(collection(db, 'categorias'), where('department', '==', cat.dept));
          const catSnap = await getDocs(catQuery);
          if (catSnap.empty) {
            const newCat = await addDoc(collection(db, 'categorias'), {
              title: cat.title,
              order: 0,
              department: cat.dept
            });
            catRefs[cat.dept] = newCat.id;
          } else {
            catRefs[cat.dept] = catSnap.docs[0].id;
          }
        }

        const products = [
          // Aesthetic
          { title: 'Limpeza de Pele Profunda', price: 150, duration: 60, dept: 'aesthetic', categoryId: catRefs['aesthetic'] },
          { title: 'Botox (3 áreas)', price: 950, duration: 30, dept: 'aesthetic', categoryId: catRefs['aesthetic'] },
          
          // Hair
          { title: 'Morena Iluminada', price: 350, duration: 180, dept: 'hair', categoryId: catRefs['hair'] },
          { title: 'Corte Feminino', price: 120, duration: 45, dept: 'hair', categoryId: catRefs['hair'] },
          { title: 'Escova & Lavagem', price: 65, duration: 40, dept: 'hair', categoryId: catRefs['hair'] },
          
          // Nails
          { title: 'Pé e Mão', price: 55, duration: 90, dept: 'nails', categoryId: catRefs['nails'] },
          { title: 'Alongamento em Fibra', price: 180, duration: 150, dept: 'nails', categoryId: catRefs['nails'] },
          
          // Makeup
          { title: 'Maquiagem Social', price: 250, duration: 90, dept: 'makeup', categoryId: catRefs['makeup'] },
          { title: 'Cílios Postiços', price: 45, duration: 15, dept: 'makeup', categoryId: catRefs['makeup'] },
          
          // Spa
          { title: 'Massagem Relaxante', price: 140, duration: 60, dept: 'spa', categoryId: catRefs['spa'] }
        ];

        const productDocs: any[] = [];
        for (const pData of products) {
          const p = {
            ...pData,
            description: 'Procedimento realizado com excelência pela equipe Prado Beauty.',
            priceType: 'fixed',
            image: 'https://images.unsplash.com/photo-1522337660859-02fbefad4740?q=80&w=640',
            isActive: true,
            gender: 'feminino'
          };
          const pQuery = query(collection(db, 'produtos'), where('title', '==', p.title));
          const pSnap = await getDocs(pQuery);
          if (pSnap.empty) {
            const docRef = await addDoc(collection(db, 'produtos'), p);
            productDocs.push({ id: docRef.id, ...p });
          } else {
            productDocs.push({ id: pSnap.docs[0].id, ...pSnap.docs[0].data() });
          }
        }

        const orders = [
          {
            customerName: 'Maria Silva',
            phone: '(11) 98765-4321',
            email: 'maria.silva@email.com',
            status: 'pending',
            items: [
              {
                title: productDocs[0].title,
                quantity: 1,
                price: 350,
                priceType: productDocs[0].priceType || 'starting',
                duration: 180,
                department: 'hair',
                appointmentDate: '2026-04-22',
                appointmentTime: '09:00'
              }
            ],
            total: 350,
            createdAt: serverTimestamp(),
            appointmentDate: '2026-04-22',
            appointmentTime: '09:00',
            orderLanguage: 'pt'
          },
          {
            customerName: 'Ana Oliveira',
            phone: '(11) 99988-7766',
            email: 'ana.oli@email.com',
            status: 'pending',
            items: [
              {
                title: productDocs[1].title,
                quantity: 1,
                price: 120,
                priceType: productDocs[1].priceType || 'fixed',
                duration: 45,
                department: 'hair',
                appointmentDate: '2026-04-22',
                appointmentTime: '13:00'
              }
            ],
            total: 120,
            createdAt: serverTimestamp(),
            appointmentDate: '2026-04-22',
            appointmentTime: '13:00',
            orderLanguage: 'pt'
          }
        ];

        for (const o of orders) {
          const oQuery = query(collection(db, 'pedidos'), where('customerName', '==', o.customerName));
          const oSnap = await getDocs(oQuery);
          if (oSnap.empty) {
            await addDoc(collection(db, 'pedidos'), o);
          }
        }

        localStorage.setItem('easyBeauty_seeded_v2', 'true');
        console.log("Seeding complete!");
      } catch (err) {
        console.error("Error seeding test data:", err);
      }
    };

    seedTestData();
  }, []);

  const glassColor = settings?.glassColor || 'rgba(255, 255, 255, 0.4)';
  const finalGlassColor = (glassColor.startsWith('#') && glassColor.length === 7) 
    ? `${glassColor}66` 
    : glassColor;

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#ffffff]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: settings?.primaryColor || '#865d39', borderTopColor: 'transparent' }} />
          <p className="text-[#4b5563] font-medium animate-pulse">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <Toaster position="top-center" richColors />
      <div 
        className="fixed inset-0 z-[-2] bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url("${settings?.backgroundImage || 'https://i.ibb.co/X0vYy7L/cakes.png'}")` }}
      />
      
      <div 
        className="fixed inset-0 z-[-1] pointer-events-none" 
        style={{ 
          backgroundColor: finalGlassColor,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)'
        }}
      />

      <div className="relative z-0 flex flex-col min-h-screen">
        {isAdmin && (
          <div className="fixed top-0 left-0 z-[100] bg-black text-white text-[10px] px-2 py-1 font-bold uppercase tracking-widest opacity-50 pointer-events-none">
            Admin Mode Active
          </div>
        )}
        {isAdmin ? (
          <Admin settings={settings} setSettings={setSettings} setIsAdmin={setIsAdmin} />
        ) : (
          <Menu settings={settings} />
        )}
        <Footer />
      </div>
    </div>
  );
}
