import React, { useState, useEffect } from 'react';
import Menu from './components/Menu';
import Admin from './components/Admin';
import Footer from './components/Footer';
import { db } from './firebase';
import { doc, onSnapshot, setDoc, getDocs, getDoc, collection, query } from 'firebase/firestore';
import { Settings, Holiday } from './types';
import { Toaster, toast } from 'sonner';

import { DEFAULT_LOGO, DEFAULT_BACKGROUND } from './constants';

const checkIsAdminRoute = () => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  const hash = window.location.hash;
  return path === '/admin' || hash === '#/admin' || hash === '#admin';
};

export default function App() {
  const [isAdmin, setIsAdmin] = useState<boolean>(checkIsAdminRoute);
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
      setIsAdmin(checkIsAdminRoute());
    };

    handleNavigation();
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);

    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('hashchange', handleNavigation);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    // Timeout de 10 segundos para o loading
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 10000);

    let geralData: Partial<Settings> | null = null;
    let bloqueiosData: { holidays?: (string | Holiday)[]; migrated?: boolean } | null = null;
    let seoData: { seoAnalysis?: string; seoHistory?: Settings['seoHistory']; migrated?: boolean } | null = null;
    let midiaData: (Partial<Settings> & { migrated?: boolean }) | null = null;
    let fundoData: { backgroundImage?: string; migrated?: boolean } | null = null;
    let pagamentosData: (Partial<Settings> & { migrated?: boolean }) | null = null;

    const mergeUniqueHolidays = (
      listA: (string | Holiday)[] = [],
      listB: (string | Holiday)[] = []
    ): (string | Holiday)[] => {
      const seen = new Set<string>();
      const result: (string | Holiday)[] = [];
      const addItem = (item: string | Holiday) => {
        if (!item) return;
        const key = typeof item === 'string'
          ? `str:${item}`
          : `obj:${item.date || ''}|${item.startTime || ''}|${item.endTime || ''}|${item.professionalId || ''}|${(item.departments || []).join(',')}|${item.notes || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      };
      listA.forEach(addItem);
      listB.forEach(addItem);
      return result;
    };

    const applyMergedSettings = () => {
      if (!geralData) return;

      const merged: Settings = {
        ...(geralData as Settings),
        ...(midiaData?.migrated ? {
          logo: midiaData.logo ?? geralData.logo ?? DEFAULT_LOGO,
          hairIcon: midiaData.hairIcon ?? geralData.hairIcon,
          makeupIcon: midiaData.makeupIcon ?? geralData.makeupIcon,
          nailsIcon: midiaData.nailsIcon ?? geralData.nailsIcon,
          spaIcon: midiaData.spaIcon ?? geralData.spaIcon,
          clinicIcon: midiaData.clinicIcon ?? geralData.clinicIcon,
          aestheticIcon: midiaData.aestheticIcon ?? geralData.aestheticIcon,
        } : {}),
        ...(fundoData?.migrated ? {
          backgroundImage: fundoData.backgroundImage ?? geralData.backgroundImage,
        } : {}),
        ...(pagamentosData?.migrated ? {
          zelleQR: pagamentosData.zelleQR ?? geralData.zelleQR,
          venmoQR: pagamentosData.venmoQR ?? geralData.venmoQR,
          paypalQR: pagamentosData.paypalQR ?? geralData.paypalQR,
          debitCardQR: pagamentosData.debitCardQR ?? geralData.debitCardQR,
          creditCardQR: pagamentosData.creditCardQR ?? geralData.creditCardQR,
          pixQR: pagamentosData.pixQR ?? geralData.pixQR,
        } : {}),
        ...(seoData?.migrated ? {
          seoAnalysis: seoData.seoAnalysis ?? '',
          seoHistory: seoData.seoHistory ?? [],
        } : {}),
        holidays: mergeUniqueHolidays(
          geralData.holidays || [],
          bloqueiosData?.holidays || []
        ),
      };

      setSettings(merged);
      setLoading(false);

      if (merged.brandName) {
        document.title = merged.brandName;
      }

      const themeColorMeta = document.getElementById('theme-color');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', merged.primaryColor || '#865d39');
      }

      const glassColor = merged.glassColor || 'rgba(255, 255, 255, 0.4)';
      const finalGlassColor = (glassColor.startsWith('#') && glassColor.length === 7)
        ? `${glassColor}66`
        : glassColor;
      document.documentElement.style.setProperty('--glass-color', finalGlassColor);

      if (merged.textColor) {
        document.documentElement.style.setProperty('--text-color', merged.textColor);
      }
    };

    if (!isAdmin) {
      // Public Menu: single one-time getDoc reads (cached via persistentLocalCache), no seo doc needed
      (async () => {
        try {
          const [geralSnap, bloqueiosSnap, midiaSnap, fundoSnap, pagamentosSnap] = await Promise.all([
            getDoc(doc(db, 'configuracoes', 'geral')),
            getDoc(doc(db, 'configuracoes', 'bloqueios')),
            getDoc(doc(db, 'configuracoes', 'midia')),
            getDoc(doc(db, 'configuracoes', 'fundo')),
            getDoc(doc(db, 'configuracoes', 'pagamentos')),
          ]);
          if (isCancelled) return;
          clearTimeout(loadingTimeout);

          let data: Settings | null = null;
          if (geralSnap.exists()) {
            data = geralSnap.data() as Settings;
          } else {
            try {
              const oldDoc = await getDocs(query(collection(db, 'settings')));
              if (!oldDoc.empty) {
                data = oldDoc.docs[0].data() as Settings;
              }
            } catch (e) {
              console.error("Erro ao tentar fallback de configurações:", e);
            }
          }

          bloqueiosData = bloqueiosSnap.exists() ? (bloqueiosSnap.data() as any) : { migrated: false };
          midiaData = midiaSnap.exists() ? (midiaSnap.data() as any) : { migrated: false };
          fundoData = fundoSnap.exists() ? (fundoSnap.data() as any) : { migrated: false };
          pagamentosData = pagamentosSnap.exists() ? (pagamentosSnap.data() as any) : { migrated: false };

          if (data) {
            geralData = data;
            applyMergedSettings();
          } else {
            setLoading(false);
          }
        } catch (error) {
          console.error("Erro na conexão com Firebase:", error);
          clearTimeout(loadingTimeout);
          setLoading(false);
          toast.error("Erro ao conectar ao banco de dados. Verifique suas regras e internet.");
        }
      })();

      return () => {
        isCancelled = true;
        clearTimeout(loadingTimeout);
      };
    }

    // Admin Mode: realtime listeners including configuracoes/seo
    const unsub = onSnapshot(doc(db, 'configuracoes', 'geral'), async (docSnap) => {
      clearTimeout(loadingTimeout);
      let data: Settings | null = null;
      
      if (docSnap.exists()) {
        data = docSnap.data() as Settings;
      } else {
        try {
          const oldDoc = await getDocs(query(collection(db, 'settings')));
          if (!oldDoc.empty) {
            data = oldDoc.docs[0].data() as Settings;
            await setDoc(doc(db, 'configuracoes', 'geral'), data);
          }
        } catch (e) {
          console.error("Erro ao tentar fallback de configurações:", e);
        }
      }

      if (data) {
        geralData = data;
        applyMergedSettings();
      } else {
        setLoading(false);
      }
    }, (error) => {
      console.error("Erro na conexão com Firebase:", error);
      clearTimeout(loadingTimeout);
      setLoading(false);
      toast.error("Erro ao conectar ao banco de dados. Verifique suas regras e internet.");
    });

    const unsubBloqueios = onSnapshot(doc(db, 'configuracoes', 'bloqueios'), (docSnap) => {
      bloqueiosData = docSnap.exists() ? (docSnap.data() as any) : { migrated: false };
      applyMergedSettings();
    }, (err) => console.warn("Erro ao carregar bloqueios:", err));

    const unsubSeo = onSnapshot(doc(db, 'configuracoes', 'seo'), (docSnap) => {
      seoData = docSnap.exists() ? (docSnap.data() as any) : { migrated: false };
      applyMergedSettings();
    }, (err) => console.warn("Erro ao carregar seo:", err));

    const unsubMidia = onSnapshot(doc(db, 'configuracoes', 'midia'), (docSnap) => {
      midiaData = docSnap.exists() ? (docSnap.data() as any) : { migrated: false };
      applyMergedSettings();
    }, (err) => console.warn("Erro ao carregar midia:", err));

    const unsubFundo = onSnapshot(doc(db, 'configuracoes', 'fundo'), (docSnap) => {
      fundoData = docSnap.exists() ? (docSnap.data() as any) : { migrated: false };
      applyMergedSettings();
    }, (err) => console.warn("Erro ao carregar fundo:", err));

    const unsubPagamentos = onSnapshot(doc(db, 'configuracoes', 'pagamentos'), (docSnap) => {
      pagamentosData = docSnap.exists() ? (docSnap.data() as any) : { migrated: false };
      applyMergedSettings();
    }, (err) => console.warn("Erro ao carregar pagamentos:", err));

    return () => {
      isCancelled = true;
      unsub();
      unsubBloqueios();
      unsubSeo();
      unsubMidia();
      unsubFundo();
      unsubPagamentos();
      clearTimeout(loadingTimeout);
    };
  }, [isAdmin]);

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
