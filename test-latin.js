const t = "Guerre au Moyen - Orient . Frappes américaines sur lIran : quelles cibles ? Quelles conséquences ? Quelle riposte?";
const latin = (t.match(/[a-zA-Z\s\d.,!?;:'"()\-]/g) || []).length / t.length;
console.log('Latin ratio:', latin.toFixed(3), 'Length:', t.length, 'Passes check (>0.85):', latin > 0.85);
