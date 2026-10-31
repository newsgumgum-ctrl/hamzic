/* =========================================================
   ALBEYK – podešavanja sistema porudžbina
   =========================================================
   Dok je "firebase" prazan (null), sistem radi u DEMO režimu:
   šank, kuhinja i sajt se vide samo u istom browseru na istom
   uređaju. Tako možeš sve da isprobaš pre povezivanja.

   Kad napraviš Firebase projekat (uputstvo u UPUTSTVO.md),
   zameni null sa objektom koji ti Firebase da, na primer:

   firebase: {
     apiKey: "AIza...",
     authDomain: "albeyk-xxxx.firebaseapp.com",
     projectId: "albeyk-xxxx",
     storageBucket: "albeyk-xxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   },
*/
window.ALBEYK_CONFIG = {
  firebase: null,

  lokal: {
    ime: "ALBEYK",
    adresa: "Jošanički kej 2, Novi Pazar",
    telefon: "063 393 318",
    whatsapp: "38163393318"
  }
};
