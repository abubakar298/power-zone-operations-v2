/** Approved Operations terminology shared by the server and employee interface. */
export const targetStageIds=['received','awaiting','solar:civil','solar:electrical','solar:testing','solar:signoff','bess:cabinet','bess:panel','bess:bessTesting','bess:handover','ups:job','documents'] as const;
export const targetLabels:Record<typeof targetStageIds[number],{label:string;group:string}>={
 received:{label:'Team & vendor assignment',group:'Common'},awaiting:{label:'Awaiting delivery',group:'Common'},
 'solar:civil':{label:'Civil & Structure',group:'Solar / Solar + BESS'},'solar:electrical':{label:'Electrical & BESS',group:'Solar / Solar + BESS'},'solar:testing':{label:'Testing & Training',group:'Solar / Solar + BESS'},'solar:signoff':{label:'Customer Sign-off',group:'Solar / Solar + BESS'},
 'bess:cabinet':{label:'Cabinet placement',group:'BESS'},'bess:panel':{label:'Electrical panel commissioning',group:'BESS'},'bess:bessTesting':{label:'BESS testing',group:'BESS'},'bess:handover':{label:'Final handover',group:'BESS'},
 'ups:job':{label:'UPS complete job',group:'UPS'},documents:{label:'Original documents to Karachi',group:'Physical documents'},
};
export const solarStages=(['civil','electrical','testing','signoff'] as const).map(id=>({id,label:targetLabels[`solar:${id}`].label}));
export const bessStages=(['cabinet','panel','bessTesting','handover'] as const).map(id=>({id,label:targetLabels[`bess:${id}`].label}));
