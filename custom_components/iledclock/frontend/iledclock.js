var Pe=globalThis,He=Pe.ShadowRoot&&(Pe.ShadyCSS===void 0||Pe.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,dt=Symbol(),Gt=new WeakMap,se=class{constructor(i,e,t){if(this._$cssResult$=!0,t!==dt)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=i,this.t=e}get styleSheet(){let i=this.o,e=this.t;if(He&&i===void 0){let t=e!==void 0&&e.length===1;t&&(i=Gt.get(e)),i===void 0&&((this.o=i=new CSSStyleSheet).replaceSync(this.cssText),t&&Gt.set(e,i))}return i}toString(){return this.cssText}},jt=r=>new se(typeof r=="string"?r:r+"",void 0,dt),_=(r,...i)=>{let e=r.length===1?r[0]:i.reduce((t,s,n)=>t+(o=>{if(o._$cssResult$===!0)return o.cssText;if(typeof o=="number")return o;throw Error("Value passed to 'css' function must be a 'css' function result: "+o+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(s)+r[n+1],r[0]);return new se(e,r,dt)},Ut=(r,i)=>{if(He)r.adoptedStyleSheets=i.map(e=>e instanceof CSSStyleSheet?e:e.styleSheet);else for(let e of i){let t=document.createElement("style"),s=Pe.litNonce;s!==void 0&&t.setAttribute("nonce",s),t.textContent=e.cssText,r.appendChild(t)}},ct=He?r=>r:r=>r instanceof CSSStyleSheet?(i=>{let e="";for(let t of i.cssRules)e+=t.cssText;return jt(e)})(r):r;var{is:kr,defineProperty:Sr,getOwnPropertyDescriptor:Cr,getOwnPropertyNames:Er,getOwnPropertySymbols:Lr,getPrototypeOf:Mr}=Object,Re=globalThis,qt=Re.trustedTypes,Ar=qt?qt.emptyScript:"",Ir=Re.reactiveElementPolyfillSupport,ne=(r,i)=>r,ut={toAttribute(r,i){switch(i){case Boolean:r=r?Ar:null;break;case Object:case Array:r=r==null?r:JSON.stringify(r)}return r},fromAttribute(r,i){let e=r;switch(i){case Boolean:e=r!==null;break;case Number:e=r===null?null:Number(r);break;case Object:case Array:try{e=JSON.parse(r)}catch{e=null}}return e}},Kt=(r,i)=>!kr(r,i),Wt={attribute:!0,type:String,converter:ut,reflect:!1,useDefault:!1,hasChanged:Kt};Symbol.metadata??=Symbol("metadata"),Re.litPropertyMetadata??=new WeakMap;var R=class extends HTMLElement{static addInitializer(i){this._$Ei(),(this.l??=[]).push(i)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(i,e=Wt){if(e.state&&(e.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(i)&&((e=Object.create(e)).wrapped=!0),this.elementProperties.set(i,e),!e.noAccessor){let t=Symbol(),s=this.getPropertyDescriptor(i,t,e);s!==void 0&&Sr(this.prototype,i,s)}}static getPropertyDescriptor(i,e,t){let{get:s,set:n}=Cr(this.prototype,i)??{get(){return this[e]},set(o){this[e]=o}};return{get:s,set(o){let a=s?.call(this);n?.call(this,o),this.requestUpdate(i,a,t)},configurable:!0,enumerable:!0}}static getPropertyOptions(i){return this.elementProperties.get(i)??Wt}static _$Ei(){if(this.hasOwnProperty(ne("elementProperties")))return;let i=Mr(this);i.finalize(),i.l!==void 0&&(this.l=[...i.l]),this.elementProperties=new Map(i.elementProperties)}static finalize(){if(this.hasOwnProperty(ne("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(ne("properties"))){let e=this.properties,t=[...Er(e),...Lr(e)];for(let s of t)this.createProperty(s,e[s])}let i=this[Symbol.metadata];if(i!==null){let e=litPropertyMetadata.get(i);if(e!==void 0)for(let[t,s]of e)this.elementProperties.set(t,s)}this._$Eh=new Map;for(let[e,t]of this.elementProperties){let s=this._$Eu(e,t);s!==void 0&&this._$Eh.set(s,e)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(i){let e=[];if(Array.isArray(i)){let t=new Set(i.flat(1/0).reverse());for(let s of t)e.unshift(ct(s))}else i!==void 0&&e.push(ct(i));return e}static _$Eu(i,e){let t=e.attribute;return t===!1?void 0:typeof t=="string"?t:typeof i=="string"?i.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){this._$ES=new Promise(i=>this.enableUpdating=i),this._$AL=new Map,this._$E_(),this.requestUpdate(),this.constructor.l?.forEach(i=>i(this))}addController(i){(this._$EO??=new Set).add(i),this.renderRoot!==void 0&&this.isConnected&&i.hostConnected?.()}removeController(i){this._$EO?.delete(i)}_$E_(){let i=new Map,e=this.constructor.elementProperties;for(let t of e.keys())this.hasOwnProperty(t)&&(i.set(t,this[t]),delete this[t]);i.size>0&&(this._$Ep=i)}createRenderRoot(){let i=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Ut(i,this.constructor.elementStyles),i}connectedCallback(){this.renderRoot??=this.createRenderRoot(),this.enableUpdating(!0),this._$EO?.forEach(i=>i.hostConnected?.())}enableUpdating(i){}disconnectedCallback(){this._$EO?.forEach(i=>i.hostDisconnected?.())}attributeChangedCallback(i,e,t){this._$AK(i,t)}_$ET(i,e){let t=this.constructor.elementProperties.get(i),s=this.constructor._$Eu(i,t);if(s!==void 0&&t.reflect===!0){let n=(t.converter?.toAttribute!==void 0?t.converter:ut).toAttribute(e,t.type);this._$Em=i,n==null?this.removeAttribute(s):this.setAttribute(s,n),this._$Em=null}}_$AK(i,e){let t=this.constructor,s=t._$Eh.get(i);if(s!==void 0&&this._$Em!==s){let n=t.getPropertyOptions(s),o=typeof n.converter=="function"?{fromAttribute:n.converter}:n.converter?.fromAttribute!==void 0?n.converter:ut;this._$Em=s;let a=o.fromAttribute(e,n.type);this[s]=a??this._$Ej?.get(s)??a,this._$Em=null}}requestUpdate(i,e,t,s=!1,n){if(i!==void 0){let o=this.constructor;if(s===!1&&(n=this[i]),t??=o.getPropertyOptions(i),!((t.hasChanged??Kt)(n,e)||t.useDefault&&t.reflect&&n===this._$Ej?.get(i)&&!this.hasAttribute(o._$Eu(i,t))))return;this.C(i,e,t)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(i,e,{useDefault:t,reflect:s,wrapped:n},o){t&&!(this._$Ej??=new Map).has(i)&&(this._$Ej.set(i,o??e??this[i]),n!==!0||o!==void 0)||(this._$AL.has(i)||(this.hasUpdated||t||(e=void 0),this._$AL.set(i,e)),s===!0&&this._$Em!==i&&(this._$Eq??=new Set).add(i))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(e){Promise.reject(e)}let i=this.scheduleUpdate();return i!=null&&await i,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??=this.createRenderRoot(),this._$Ep){for(let[s,n]of this._$Ep)this[s]=n;this._$Ep=void 0}let t=this.constructor.elementProperties;if(t.size>0)for(let[s,n]of t){let{wrapped:o}=n,a=this[s];o!==!0||this._$AL.has(s)||a===void 0||this.C(s,void 0,n,a)}}let i=!1,e=this._$AL;try{i=this.shouldUpdate(e),i?(this.willUpdate(e),this._$EO?.forEach(t=>t.hostUpdate?.()),this.update(e)):this._$EM()}catch(t){throw i=!1,this._$EM(),t}i&&this._$AE(e)}willUpdate(i){}_$AE(i){this._$EO?.forEach(e=>e.hostUpdated?.()),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(i)),this.updated(i)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(i){return!0}update(i){this._$Eq&&=this._$Eq.forEach(e=>this._$ET(e,this[e])),this._$EM()}updated(i){}firstUpdated(i){}};R.elementStyles=[],R.shadowRootOptions={mode:"open"},R[ne("elementProperties")]=new Map,R[ne("finalized")]=new Map,Ir?.({ReactiveElement:R}),(Re.reactiveElementVersions??=[]).push("2.1.2");var ht=globalThis,Zt=r=>r,De=ht.trustedTypes,Yt=De?De.createPolicy("lit-html",{createHTML:r=>r}):void 0,mt="$lit$",D=`lit$${Math.random().toFixed(9).slice(2)}$`,gt="?"+D,Tr=`<${gt}>`,j=document,ae=()=>j.createComment(""),le=r=>r===null||typeof r!="object"&&typeof r!="function",ft=Array.isArray,ii=r=>ft(r)||typeof r?.[Symbol.iterator]=="function",pt=`[ 	
\f\r]`,oe=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,Xt=/-->/g,Qt=/>/g,B=RegExp(`>|${pt}(?:([^\\s"'>=/]+)(${pt}*=${pt}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Jt=/'/g,ei=/"/g,ri=/^(?:script|style|textarea|title)$/i,_t=r=>(i,...e)=>({_$litType$:r,strings:i,values:e}),l=_t(1),Be=_t(2),Gs=_t(3),U=Symbol.for("lit-noChange"),c=Symbol.for("lit-nothing"),ti=new WeakMap,G=j.createTreeWalker(j,129);function si(r,i){if(!ft(r)||!r.hasOwnProperty("raw"))throw Error("invalid template strings array");return Yt!==void 0?Yt.createHTML(i):i}var ni=(r,i)=>{let e=r.length-1,t=[],s,n=i===2?"<svg>":i===3?"<math>":"",o=oe;for(let a=0;a<e;a++){let d=r[a],p,u,h=-1,b=0;for(;b<d.length&&(o.lastIndex=b,u=o.exec(d),u!==null);)b=o.lastIndex,o===oe?u[1]==="!--"?o=Xt:u[1]!==void 0?o=Qt:u[2]!==void 0?(ri.test(u[2])&&(s=RegExp("</"+u[2],"g")),o=B):u[3]!==void 0&&(o=B):o===B?u[0]===">"?(o=s??oe,h=-1):u[1]===void 0?h=-2:(h=o.lastIndex-u[2].length,p=u[1],o=u[3]===void 0?B:u[3]==='"'?ei:Jt):o===ei||o===Jt?o=B:o===Xt||o===Qt?o=oe:(o=B,s=void 0);let f=o===B&&r[a+1].startsWith("/>")?" ":"";n+=o===oe?d+Tr:h>=0?(t.push(p),d.slice(0,h)+mt+d.slice(h)+D+f):d+D+(h===-2?a:f)}return[si(r,n+(r[e]||"<?>")+(i===2?"</svg>":i===3?"</math>":"")),t]},de=class r{constructor({strings:i,_$litType$:e},t){let s;this.parts=[];let n=0,o=0,a=i.length-1,d=this.parts,[p,u]=ni(i,e);if(this.el=r.createElement(p,t),G.currentNode=this.el.content,e===2||e===3){let h=this.el.content.firstChild;h.replaceWith(...h.childNodes)}for(;(s=G.nextNode())!==null&&d.length<a;){if(s.nodeType===1){if(s.hasAttributes())for(let h of s.getAttributeNames())if(h.endsWith(mt)){let b=u[o++],f=s.getAttribute(h).split(D),v=/([.?@])?(.*)/.exec(b);d.push({type:1,index:n,name:v[2],strings:f,ctor:v[1]==="."?Fe:v[1]==="?"?Ve:v[1]==="@"?ze:W}),s.removeAttribute(h)}else h.startsWith(D)&&(d.push({type:6,index:n}),s.removeAttribute(h));if(ri.test(s.tagName)){let h=s.textContent.split(D),b=h.length-1;if(b>0){s.textContent=De?De.emptyScript:"";for(let f=0;f<b;f++)s.append(h[f],ae()),G.nextNode(),d.push({type:2,index:++n});s.append(h[b],ae())}}}else if(s.nodeType===8)if(s.data===gt)d.push({type:2,index:n});else{let h=-1;for(;(h=s.data.indexOf(D,h+1))!==-1;)d.push({type:7,index:n}),h+=D.length-1}n++}}static createElement(i,e){let t=j.createElement("template");return t.innerHTML=i,t}};function q(r,i,e=r,t){if(i===U)return i;let s=t!==void 0?e._$Co?.[t]:e._$Cl,n=le(i)?void 0:i._$litDirective$;return s?.constructor!==n&&(s?._$AO?.(!1),n===void 0?s=void 0:(s=new n(r),s._$AT(r,e,t)),t!==void 0?(e._$Co??=[])[t]=s:e._$Cl=s),s!==void 0&&(i=q(r,s._$AS(r,i.values),s,t)),i}var Oe=class{constructor(i,e){this._$AV=[],this._$AN=void 0,this._$AD=i,this._$AM=e}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(i){let{el:{content:e},parts:t}=this._$AD,s=(i?.creationScope??j).importNode(e,!0);G.currentNode=s;let n=G.nextNode(),o=0,a=0,d=t[0];for(;d!==void 0;){if(o===d.index){let p;d.type===2?p=new Y(n,n.nextSibling,this,i):d.type===1?p=new d.ctor(n,d.name,d.strings,this,i):d.type===6&&(p=new Ne(n,this,i)),this._$AV.push(p),d=t[++a]}o!==d?.index&&(n=G.nextNode(),o++)}return G.currentNode=j,s}p(i){let e=0;for(let t of this._$AV)t!==void 0&&(t.strings!==void 0?(t._$AI(i,t,e),e+=t.strings.length-2):t._$AI(i[e])),e++}},Y=class r{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(i,e,t,s){this.type=2,this._$AH=c,this._$AN=void 0,this._$AA=i,this._$AB=e,this._$AM=t,this.options=s,this._$Cv=s?.isConnected??!0}get parentNode(){let i=this._$AA.parentNode,e=this._$AM;return e!==void 0&&i?.nodeType===11&&(i=e.parentNode),i}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(i,e=this){i=q(this,i,e),le(i)?i===c||i==null||i===""?(this._$AH!==c&&this._$AR(),this._$AH=c):i!==this._$AH&&i!==U&&this._(i):i._$litType$!==void 0?this.$(i):i.nodeType!==void 0?this.T(i):ii(i)?this.k(i):this._(i)}O(i){return this._$AA.parentNode.insertBefore(i,this._$AB)}T(i){this._$AH!==i&&(this._$AR(),this._$AH=this.O(i))}_(i){this._$AH!==c&&le(this._$AH)?this._$AA.nextSibling.data=i:this.T(j.createTextNode(i)),this._$AH=i}$(i){let{values:e,_$litType$:t}=i,s=typeof t=="number"?this._$AC(i):(t.el===void 0&&(t.el=de.createElement(si(t.h,t.h[0]),this.options)),t);if(this._$AH?._$AD===s)this._$AH.p(e);else{let n=new Oe(s,this),o=n.u(this.options);n.p(e),this.T(o),this._$AH=n}}_$AC(i){let e=ti.get(i.strings);return e===void 0&&ti.set(i.strings,e=new de(i)),e}k(i){ft(this._$AH)||(this._$AH=[],this._$AR());let e=this._$AH,t,s=0;for(let n of i)s===e.length?e.push(t=new r(this.O(ae()),this.O(ae()),this,this.options)):t=e[s],t._$AI(n),s++;s<e.length&&(this._$AR(t&&t._$AB.nextSibling,s),e.length=s)}_$AR(i=this._$AA.nextSibling,e){for(this._$AP?.(!1,!0,e);i!==this._$AB;){let t=Zt(i).nextSibling;Zt(i).remove(),i=t}}setConnected(i){this._$AM===void 0&&(this._$Cv=i,this._$AP?.(i))}},W=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(i,e,t,s,n){this.type=1,this._$AH=c,this._$AN=void 0,this.element=i,this.name=e,this._$AM=s,this.options=n,t.length>2||t[0]!==""||t[1]!==""?(this._$AH=Array(t.length-1).fill(new String),this.strings=t):this._$AH=c}_$AI(i,e=this,t,s){let n=this.strings,o=!1;if(n===void 0)i=q(this,i,e,0),o=!le(i)||i!==this._$AH&&i!==U,o&&(this._$AH=i);else{let a=i,d,p;for(i=n[0],d=0;d<n.length-1;d++)p=q(this,a[t+d],e,d),p===U&&(p=this._$AH[d]),o||=!le(p)||p!==this._$AH[d],p===c?i=c:i!==c&&(i+=(p??"")+n[d+1]),this._$AH[d]=p}o&&!s&&this.j(i)}j(i){i===c?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,i??"")}},Fe=class extends W{constructor(){super(...arguments),this.type=3}j(i){this.element[this.name]=i===c?void 0:i}},Ve=class extends W{constructor(){super(...arguments),this.type=4}j(i){this.element.toggleAttribute(this.name,!!i&&i!==c)}},ze=class extends W{constructor(i,e,t,s,n){super(i,e,t,s,n),this.type=5}_$AI(i,e=this){if((i=q(this,i,e,0)??c)===U)return;let t=this._$AH,s=i===c&&t!==c||i.capture!==t.capture||i.once!==t.once||i.passive!==t.passive,n=i!==c&&(t===c||s);s&&this.element.removeEventListener(this.name,this,t),n&&this.element.addEventListener(this.name,this,i),this._$AH=i}handleEvent(i){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,i):this._$AH.handleEvent(i)}},Ne=class{constructor(i,e,t){this.element=i,this.type=6,this._$AN=void 0,this._$AM=e,this.options=t}get _$AU(){return this._$AM._$AU}_$AI(i){q(this,i)}},oi={M:mt,P:D,A:gt,C:1,L:ni,R:Oe,D:ii,V:q,I:Y,H:W,N:Ve,U:ze,B:Fe,F:Ne},Pr=ht.litHtmlPolyfillSupport;Pr?.(de,Y),(ht.litHtmlVersions??=[]).push("3.3.3");var ai=(r,i,e)=>{let t=e?.renderBefore??i,s=t._$litPart$;if(s===void 0){let n=e?.renderBefore??null;t._$litPart$=s=new Y(i.insertBefore(ae(),n),n,void 0,e??{})}return s._$AI(r),s};var bt=globalThis,g=class extends R{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){let i=super.createRenderRoot();return this.renderOptions.renderBefore??=i.firstChild,i}update(i){let e=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(i),this._$Do=ai(e,this.renderRoot,this.renderOptions)}connectedCallback(){super.connectedCallback(),this._$Do?.setConnected(!0)}disconnectedCallback(){super.disconnectedCallback(),this._$Do?.setConnected(!1)}render(){return U}};g._$litElement$=!0,g.finalized=!0,bt.litElementHydrateSupport?.({LitElement:g});var Hr=bt.litElementPolyfillSupport;Hr?.({LitElement:g});(bt.litElementVersions??=[]).push("4.2.2");var{I:sn}=oi;var li=r=>r.strings===void 0;var di={ATTRIBUTE:1,CHILD:2,PROPERTY:3,BOOLEAN_ATTRIBUTE:4,EVENT:5,ELEMENT:6},vt=r=>(...i)=>({_$litDirective$:r,values:i}),Ge=class{constructor(i){}get _$AU(){return this._$AM._$AU}_$AT(i,e,t){this._$Ct=i,this._$AM=e,this._$Ci=t}_$AS(i,e){return this.update(i,e)}update(i,e){return this.render(...e)}};var ce=(r,i)=>{let e=r._$AN;if(e===void 0)return!1;for(let t of e)t._$AO?.(i,!1),ce(t,i);return!0},je=r=>{let i,e;do{if((i=r._$AM)===void 0)break;e=i._$AN,e.delete(r),r=i}while(e?.size===0)},ci=r=>{for(let i;i=r._$AM;r=i){let e=i._$AN;if(e===void 0)i._$AN=e=new Set;else if(e.has(r))break;e.add(r),Or(i)}};function Rr(r){this._$AN!==void 0?(je(this),this._$AM=r,ci(this)):this._$AM=r}function Dr(r,i=!1,e=0){let t=this._$AH,s=this._$AN;if(s!==void 0&&s.size!==0)if(i)if(Array.isArray(t))for(let n=e;n<t.length;n++)ce(t[n],!1),je(t[n]);else t!=null&&(ce(t,!1),je(t));else ce(this,r)}var Or=r=>{r.type==di.CHILD&&(r._$AP??=Dr,r._$AQ??=Rr)},Ue=class extends Ge{constructor(){super(...arguments),this._$AN=void 0}_$AT(i,e,t){super._$AT(i,e,t),ci(this),this.isConnected=i._$AU}_$AO(i,e=!0){i!==this.isConnected&&(this.isConnected=i,i?this.reconnected?.():this.disconnected?.()),e&&(ce(this,i),je(this))}setValue(i){if(li(this._$Ct))this._$Ct._$AI(i,this);else{let e=[...this._$Ct._$AH];e[this._$Ci]=i,this._$Ct._$AI(e,this,0)}}disconnected(){}reconnected(){}};var X=()=>new xt,xt=class{},yt=new WeakMap,I=vt(class extends Ue{render(r){return c}update(r,[i]){let e=i!==this.G;return e&&this.rt(void 0),(e||this.lt!==this.ct)&&(this.G=i,this.ht=r.options?.host,this.rt(this.ct=r.element)),c}rt(r){if(this.G!==void 0)if(this.isConnected||(r=void 0),typeof this.G=="function"){let i=this.ht??globalThis,e=yt.get(i);e===void 0&&(e=new WeakMap,yt.set(i,e)),e.get(this.G)!==void 0&&this.G.call(this.ht,void 0),e.set(this.G,r),r!==void 0&&this.G.call(this.ht,r)}else this.G.value=r}get lt(){return typeof this.G=="function"?yt.get(this.ht??globalThis)?.get(this.G):this.G?.value}disconnected(){this.lt===this.ct&&this.rt(void 0)}reconnected(){this.rt(this.ct)}});function P(r=32,i=16,e=[0,0,0],t=100){let s=new Uint8Array(r*i*3);for(let n=0;n<s.length;n+=3)s[n]=e[0],s[n+1]=e[1],s[n+2]=e[2];return{width:r,height:i,pixels:s,durationMs:t}}function C(r,i=r.durationMs){return{width:r.width,height:r.height,pixels:r.pixels.slice(),durationMs:i}}function Q(r,i,e){return i>=0&&e>=0&&i<r.width&&e<r.height}function V(r,i,e){if(!Q(r,i,e))return[0,0,0];let t=(e*r.width+i)*3;return[r.pixels[t],r.pixels[t+1],r.pixels[t+2]]}function qe(r,i,e,t){let s=C(r);return k(s,i,e,t),s}function k(r,i,e,t){if(!Q(r,i,e))return;let s=(e*r.width+i)*3;r.pixels[s]=t[0],r.pixels[s+1]=t[1],r.pixels[s+2]=t[2]}function ui(r,i,e,t,s=[0,0,0]){let n=P(r.width,r.height,s,r.durationMs);for(let o=0;o<r.height;o++)for(let a=0;a<r.width;a++){let d=a-i,p=o-e;if(t)d=(d%r.width+r.width)%r.width,p=(p%r.height+r.height)%r.height;else if(!Q(r,d,p))continue;k(n,a,o,V(r,d,p))}return n}function pi(r,i){let e=C(r);for(let t=0;t<r.height;t++)for(let s=0;s<r.width;s++){let n=i==="horizontal"?V(r,r.width-1-s,t):V(r,s,r.height-1-t);k(e,s,t,n)}return e}function hi(r,i,e,t,s=.78){let n=Math.min(r/e,i/t),o=n*e,a=n*t;return{cellSize:n,dotRadius:n*s/2,offsetX:(r-o)/2+n/2,offsetY:(i-a)/2+n/2}}function mi(r,i,e){return[r.offsetX+i*r.cellSize,r.offsetY+e*r.cellSize]}function gi(r,i,e,t,s){let n=Math.round((i-r.offsetX)/r.cellSize),o=Math.round((e-r.offsetY)/r.cellSize);return n<0||o<0||n>=t||o>=s?null:[n,o]}var Fr=.05,ue=class extends g{constructor(){super();this._canvasRef=X();this._resizeObserver=null;this._layout=null;this._dpr=1;this._onPointerDown=e=>{this.interactive&&(e.currentTarget.setPointerCapture(e.pointerId),e.preventDefault(),this._emitPointer(e,"down"))};this._onPointerMove=e=>{!this.interactive||e.buttons===0||this._emitPointer(e,"move")};this._onPointerUp=e=>{this.interactive&&this._emitPointer(e,"up")};this._onPointerLeave=e=>{!this.interactive||e.buttons!==0||this._emitPointer(e,"leave")};this.frame=null,this.interactive=!1,this.showGrid=!1,this.bloom=!0}connectedCallback(){super.connectedCallback(),this._resizeObserver=new ResizeObserver(()=>this._resize())}disconnectedCallback(){super.disconnectedCallback(),this._resizeObserver?.disconnect(),this._resizeObserver=null}firstUpdated(){this._canvasRef.value&&this._resizeObserver?.observe(this._canvasRef.value),this._resize()}updated(e){(e.has("frame")||e.has("showGrid")||e.has("bloom"))&&this._draw()}_resize(){let e=this._canvasRef.value;if(!e)return;let t=e.getBoundingClientRect();if(t.width===0||t.height===0)return;this._dpr=window.devicePixelRatio||1,e.width=Math.max(1,Math.round(t.width*this._dpr)),e.height=Math.max(1,Math.round(t.height*this._dpr));let s=this.frame?.width??32,n=this.frame?.height??16;this._layout=hi(e.width,e.height,s,n),this._draw()}_draw(){let e=this._canvasRef.value,t=e?.getContext("2d");if(!e||!t||!this._layout)return;let s=this._layout,n=this.frame?.width??32,o=this.frame?.height??16;t.clearRect(0,0,e.width,e.height),t.fillStyle="#050607",t.fillRect(0,0,e.width,e.height);for(let a=0;a<o;a++)for(let d=0;d<n;d++){let p=A=>Math.max(0,Math.min(255,Math.round(A))),[u,h,b]=this.frame?[p(this.frame.pixels[(a*n+d)*3]),p(this.frame.pixels[(a*n+d)*3+1]),p(this.frame.pixels[(a*n+d)*3+2])]:[0,0,0],[f,v]=mi(s,d,a);if(!(u>0||h>0||b>0)){t.beginPath(),t.fillStyle=`rgba(255, 255, 255, ${Fr})`,t.arc(f,v,s.dotRadius*.72,0,Math.PI*2),t.fill();continue}this.bloom&&(t.save(),t.shadowColor=`rgb(${u}, ${h}, ${b})`,t.shadowBlur=s.dotRadius*1.6,t.beginPath(),t.fillStyle=`rgb(${u}, ${h}, ${b})`,t.arc(f,v,s.dotRadius,0,Math.PI*2),t.fill(),t.restore());let $=t.createRadialGradient(f,v,0,f,v,s.dotRadius);$.addColorStop(0,`rgb(${Math.min(255,u+40)}, ${Math.min(255,h+40)}, ${Math.min(255,b+40)})`),$.addColorStop(1,`rgb(${u}, ${h}, ${b})`),t.beginPath(),t.fillStyle=$,t.arc(f,v,s.dotRadius,0,Math.PI*2),t.fill()}if(this.showGrid){t.strokeStyle="rgba(255, 255, 255, 0.05)",t.lineWidth=1;for(let a=0;a<=n;a++){let d=s.offsetX-s.cellSize/2+a*s.cellSize;t.beginPath(),t.moveTo(d,s.offsetY-s.cellSize/2),t.lineTo(d,s.offsetY-s.cellSize/2+o*s.cellSize),t.stroke()}for(let a=0;a<=o;a++){let d=s.offsetY-s.cellSize/2+a*s.cellSize;t.beginPath(),t.moveTo(s.offsetX-s.cellSize/2,d),t.lineTo(s.offsetX-s.cellSize/2+n*s.cellSize,d),t.stroke()}}}_emitPointer(e,t){let s=this._canvasRef.value;if(!s||!this._layout)return;let n=s.getBoundingClientRect(),o=(e.clientX-n.left)/n.width*s.width,a=(e.clientY-n.top)/n.height*s.height,d=this.frame?.width??32,p=this.frame?.height??16,u=t==="leave"?null:gi(this._layout,o,a,d,p);!u&&t!=="leave"||this.dispatchEvent(new CustomEvent("matrix-pointer",{detail:{x:u?.[0]??-1,y:u?.[1]??-1,phase:t,buttons:e.buttons,pointerId:e.pointerId},bubbles:!0,composed:!0}))}render(){return l`<canvas
      ${I(this._canvasRef)}
      class=${this.interactive?"interactive":""}
      @pointerdown=${this._onPointerDown}
      @pointermove=${this._onPointerMove}
      @pointerup=${this._onPointerUp}
      @pointercancel=${this._onPointerUp}
      @pointerleave=${this._onPointerLeave}
    ></canvas>`}};ue.properties={frame:{attribute:!1},interactive:{type:Boolean},showGrid:{type:Boolean,attribute:"show-grid"},bloom:{type:Boolean}},ue.styles=_`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      contain: layout size;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: inherit;
      touch-action: none;
    }
    canvas.interactive {
      cursor: crosshair;
    }
  `;customElements.define("iledclock-matrix-canvas",ue);var y=_`
  :host {
    /* host-theme colour roles */
    --lu-accent: var(--primary-color);
    --lu-accent-ink: var(--text-primary-color, #fff);
    --lu-ink: var(--primary-text-color);
    --lu-ink-2: var(--secondary-text-color);
    --lu-ink-3: var(--disabled-text-color, var(--secondary-text-color));
    --lu-positive: var(--success-color, #43a047);
    --lu-warning: var(--warning-color, #ffa600);
    --lu-danger: var(--error-color, #db4437);
    --lu-info: var(--info-color, #039be5);
    --lu-live: var(--error-color, #db4437);

    /* glass levels derived from the theme's own card colour and text colour */
    --lu-card: var(--ha-card-background, var(--card-background-color));
    --lu-edge: var(--ha-card-border-color, var(--divider-color));
    --lu-tile: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
    --lu-glass-raised: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
    --lu-edge-raised: color-mix(in srgb, var(--primary-text-color) 22%, transparent);
    --lu-track-off: color-mix(in srgb, var(--primary-text-color) 16%, transparent);
    --lu-accent-soft: color-mix(in srgb, var(--primary-color) 18%, transparent);
    --lu-scrim: color-mix(in srgb, var(--primary-background-color) 55%, transparent);

    /* shape: concentric with whatever radius the theme gives cards */
    --lu-radius-card: var(--ha-card-border-radius, 24px);
    --lu-radius-tile: max(calc(var(--lu-radius-card) - 4px), 8px);
    --lu-radius-row: max(calc(var(--lu-radius-card) - 6px), 8px);
    --lu-radius-control: max(calc(var(--lu-radius-card) - 10px), 6px);
    --lu-radius-pill: 999px;
    --lu-target: 48px;

    /* material: soft and theme-relative; heavy lift only on raised elements */
    --lu-highlight-raised: inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent);
    --lu-shadow-raised: 0 10px 24px color-mix(in srgb, #000 22%, transparent);
    --lu-shadow-pressed: 0 4px 10px color-mix(in srgb, #000 18%, transparent);

    /* motion and type */
    --lu-ease: cubic-bezier(0.33, 1, 0.68, 1);
    --lu-motion-press: 90ms;
    --lu-motion-focus: 150ms;
    --lu-motion-card: 180ms;
    --lu-motion-layer: 220ms;
    --lu-hold: 1500ms;
    --lu-font: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, inherit));
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --lu-motion-focus: 0ms;
      --lu-motion-card: 0ms;
      --lu-motion-layer: 120ms;
    }
  }
`;function We(){return typeof window<"u"&&window.matchMedia?.("(prefers-reduced-motion: reduce)").matches===!0}var pe=class extends g{constructor(){super(),this.value="",this.options=[],this.groupLabel="",this.disabled=!1,this.contentFit=!1}render(){return l`
      <div class="segments" role="radiogroup" aria-label=${this.groupLabel}>
        ${this.options.map(i=>l`
            <button
              type="button"
              role="radio"
              aria-checked=${i.value===this.value}
              class="segment ${i.value===this.value?"selected":""}"
              ?disabled=${this.disabled}
              @click=${()=>this._select(i.value)}
            >
              <span class="segment-label">${i.label}</span>
            </button>
          `)}
      </div>
    `}_select(i){this.disabled||this.dispatchEvent(new CustomEvent("option-selected",{detail:{value:i},bubbles:!0,composed:!0}))}};pe.properties={value:{type:String},options:{attribute:!1},groupLabel:{type:String,attribute:"group-label"},disabled:{type:Boolean},contentFit:{type:Boolean,attribute:"content-fit"}},pe.styles=[y,_`
    :host {
      display: block;
      container-type: inline-size;
    }
    .segments {
      display: flex;
      gap: 6px;
    }
    .segment {
      flex: 1 1 0;
      min-width: var(--lu-target, 48px);
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: none;
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      color: var(--primary-text-color);
      font-size: var(--iledclock-segment-size, 15px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1.1;
      overflow: hidden;
      padding: 0 4px;
      box-sizing: border-box;
      transition: background-color 0.15s ease, color 0.15s ease, transform 0.08s ease;
    }
    /* content-fit pills size to their labels: no size containment (a size container has no
       intrinsic width, so inside a flex row the whole picker collapsed to 0 px and its pills
       rendered empty), and they wrap onto a second row instead of truncating to "A...". */
    :host([content-fit]) {
      container-type: normal;
    }
    :host([content-fit]) .segments {
      flex-wrap: wrap;
    }
    :host([content-fit]) .segment {
      flex: 1 0 auto;
      min-width: 0;
      padding: 0 14px;
    }
    :host([content-fit]) .segment-label {
      overflow: visible;
    }
    @container (max-width: 300px) {
      :host([content-fit]) .segment-label {
        font-size: 13px;
      }
    }
    .segment-label {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .segment:active:not(:disabled) {
      transform: scale(0.97);
    }
    .segment.selected {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .segment:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .segment:focus-visible {
      outline: 2px solid var(--lu-accent);
      outline-offset: 2px;
    }
    `];customElements.define("iledclock-segmented-picker",pe);var he=class extends g{constructor(){super(),this.value=0,this.min=0,this.max=100,this.step=1,this.disabled=!1,this.label="value"}render(){return l`
      <div class="stepper">
        <button type="button" class="step-btn" ?disabled=${this.disabled||this.value<=this.min} @click=${this._decrement} aria-label="Decrease ${this.label}">
          &minus;
        </button>
        <span class="value">${this.value}</span>
        <button type="button" class="step-btn" ?disabled=${this.disabled||this.value>=this.max} @click=${this._increment} aria-label="Increase ${this.label}">
          &plus;
        </button>
      </div>
    `}_decrement(){this._emit(Math.max(this.min,this.value-this.step))}_increment(){this._emit(Math.min(this.max,this.value+this.step))}_emit(i){i!==this.value&&this.dispatchEvent(new CustomEvent("value-selected",{detail:{value:i},bubbles:!0,composed:!0}))}};he.properties={value:{type:Number},min:{type:Number},max:{type:Number},step:{type:Number},disabled:{type:Boolean},label:{type:String}},he.styles=[y,_`
    :host {
      display: block;
    }
    .stepper {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .step-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: 2px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
      flex: none;
    }
    .step-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .step-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .step-btn:focus-visible {
      outline: 2px solid var(--lu-accent);
      outline-offset: 2px;
    }
    .value {
      min-width: 2.2em;
      text-align: center;
      font-size: 20px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--primary-text-color);
    }
    `];customElements.define("iledclock-stepper",he);var me={phase:"idle",elapsedMs:0},fi={durationMs:1500,drainMs:400};function _i(){return{phase:"charging",elapsedMs:0}}function bi(r,i,e){if(r.phase==="charging"){let t=r.elapsedMs+i;return t>=e.durationMs?{phase:"completed",elapsedMs:e.durationMs}:{phase:"charging",elapsedMs:t}}if(r.phase==="draining"){let t=r.elapsedMs-i;return t<=0?me:{phase:"draining",elapsedMs:t}}return r}function vi(r){return r.phase!=="charging"?r:{phase:"draining",elapsedMs:r.elapsedMs}}function yi(r,i){return r.phase==="completed"?1:r.phase==="idle"?0:Math.max(0,Math.min(1,r.elapsedMs/i.durationMs))}function wt(r){typeof window>"u"||window.dispatchEvent(new CustomEvent("haptic",{detail:r}))}var Vr={menu:"M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z",cog:"M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",power:"M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13",brightness:"M12,18V6A6,6 0 0,1 18,12A6,6 0 0,1 12,18M20,15.31L23.31,12L20,8.69V4H15.31L12,0.69L8.69,4H4V8.69L0.69,12L4,15.31V20H8.69L12,23.31L15.31,20H20V15.31Z",pen:"M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z",eraser:"M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z",fill:"M19,11.5C19,11.5 17,13.67 17,15A2,2 0 0,0 19,17A2,2 0 0,0 21,15C21,13.67 19,11.5 19,11.5M5.21,10L10,5.21L14.79,10M16.56,8.94L7.62,0L6.21,1.41L8.59,3.79L3.44,8.94C2.85,9.5 2.85,10.47 3.44,11.06L8.94,16.56C9.23,16.85 9.62,17 10,17C10.38,17 10.77,16.85 11.06,16.56L16.56,11.06C17.15,10.47 17.15,9.5 16.56,8.94Z",line:"M15,3V7.59L7.59,15H3V21H9V16.42L16.42,9H21V3M17,5H19V7H17M5,17H7V19H5",rectangle:"M4,6V19H20V6H4M18,17H6V8H18V17Z",ellipse:"M12,6C16.41,6 20,8.69 20,12C20,15.31 16.41,18 12,18C7.59,18 4,15.31 4,12C4,8.69 7.59,6 12,6M12,4C6.5,4 2,7.58 2,12C2,16.42 6.5,20 12,20C17.5,20 22,16.42 22,12C22,7.58 17.5,4 12,4Z",eyedropper:"M19.35,11.72L17.22,13.85L15.81,12.43L8.1,20.14L3.5,22L2,20.5L3.86,15.9L11.57,8.19L10.15,6.78L12.28,4.65L19.35,11.72M16.76,3C17.93,1.83 19.83,1.83 21,3C22.17,4.17 22.17,6.07 21,7.24L19.08,9.16L14.84,4.92L16.76,3M5.56,17.03L4.5,19.5L6.97,18.44L14.4,11L13,9.6L5.56,17.03Z",textStamp:"M18.5,4L19.66,8.35L18.7,8.61C18.25,7.74 17.79,6.87 17.26,6.43C16.73,6 16.11,6 15.5,6H13V16.5C13,17 13,17.5 13.33,17.75C13.67,18 14.33,18 15,18V19H9V18C9.67,18 10.33,18 10.67,17.75C11,17.5 11,17 11,16.5V6H8.5C7.89,6 7.27,6 6.74,6.43C6.21,6.87 5.75,7.74 5.3,8.61L4.34,8.35L5.5,4H18.5Z",flipH:"M15 21H17V19H15M19 9H21V7H19M3 5V19C3 20.1 3.9 21 5 21H9V19H5V5H9V3H5C3.9 3 3 3.9 3 5M19 3V5H21C21 3.9 20.1 3 19 3M11 23H13V1H11M19 17H21V15H19M15 5H17V3H15M19 13H21V11H19M19 21C20.1 21 21 20.1 21 19H19Z",flipV:"M3 15V17H5V15M15 19V21H17V19M19 3H5C3.9 3 3 3.9 3 5V9H5V5H19V9H21V5C21 3.9 20.1 3 19 3M21 19H19V21C20.1 21 21 20.1 21 19M1 11V13H23V11M7 19V21H9V19M19 15V17H21V15M11 19V21H13V19M3 19C3 20.1 3.9 21 5 21V19Z",shift:"M13,11H18L16.5,9.5L17.92,8.08L21.84,12L17.92,15.92L16.5,14.5L18,13H13V18L14.5,16.5L15.92,17.92L12,21.84L8.08,17.92L9.5,16.5L11,18V13H6L7.5,14.5L6.08,15.92L2.16,12L6.08,8.08L7.5,9.5L6,11H11V6L9.5,7.5L8.08,6.08L12,2.16L15.92,6.08L14.5,7.5L13,6V11Z",undo:"M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z",redo:"M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z",save:"M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z",duplicate:"M11,17H4A2,2 0 0,1 2,15V3A2,2 0 0,1 4,1H16V3H4V15H11V13L15,16L11,19V17M19,21V7H8V13H6V7A2,2 0 0,1 8,5H19A2,2 0 0,1 21,7V21A2,2 0 0,1 19,23H8A2,2 0 0,1 6,21V19H8V21H19Z",delete:"M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19M8,9H16V19H8V9M15.5,4L14.5,3H9.5L8.5,4H5V6H19V4H15.5Z",plus:"M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",minus:"M19,13H5V11H19V13Z",play:"M8,5.14V19.14L19,12.14L8,5.14Z",pause:"M14,19H18V5H14M6,19H10V5H6V19Z",chevronLeft:"M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z",chevronRight:"M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z",chevronUp:"M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z",chevronDown:"M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z",check:"M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z",close:"M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z",upload:"M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20H13Q12.18 20 11.59 19.41 11 18.83 11 18V12.85L9.4 14.4L8 13L12 9L16 13L14.6 14.4L13 12.85V18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18H9V20M12 13Z",image:"M19,19H5V5H19M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M13.96,12.29L11.21,15.83L9.25,13.47L6.5,17H17.5L13.96,12.29Z",gif:"M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M10 10.5H7.5V13.5H8.5V12H10V13.7C10 14.4 9.5 15 8.7 15H7.3C6.5 15 6 14.3 6 13.7V10.4C6 9.7 6.5 9 7.3 9H8.6C9.5 9 10 9.7 10 10.3V10.5M13 15H11.5V9H13V15M17.5 10.5H16V11.5H17.5V13H16V15H14.5V9H17.5V10.5Z",generative:"M19,1L17.74,3.75L15,5L17.74,6.26L19,9L20.25,6.26L23,5L20.25,3.75M9,4L6.5,9.5L1,12L6.5,14.5L9,20L11.5,14.5L17,12L11.5,9.5M19,15L17.74,17.74L15,19L17.74,20.25L19,23L20.25,20.25L23,19L20.25,17.74",palette:"M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z",stopwatch:"M12,20A7,7 0 0,1 5,13A7,7 0 0,1 12,6A7,7 0 0,1 19,13A7,7 0 0,1 12,20M19.03,7.39L20.45,5.97C20,5.46 19.55,5 19.04,4.56L17.62,6C16.07,4.74 14.12,4 12,4A9,9 0 0,0 3,13A9,9 0 0,0 12,22C17,22 21,17.97 21,13C21,10.88 20.26,8.93 19.03,7.39M11,14H13V8H11M15,1H9V3H15V1Z",countdown:"M6,2H18V8H18V8L14,12L18,16V16H18V22H6V16H6V16L10,12L6,8V8H6V2M16,16.5L12,12.5L8,16.5V20H16V16.5M12,11.5L16,7.5V4H8V7.5L12,11.5M10,6H14V6.75L12,8.75L10,6.75V6Z",scoreboard:"M21 3H3C1.9 3 1 3.9 1 5V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V5C23 3.9 22.1 3 21 3M21 19H3V5H21M5 7H9C9.6 7 10 7.4 10 8V16C10 16.6 9.6 17 9 17H5C4.4 17 4 16.6 4 16V8C4 7.4 4.4 7 5 7M6 9V15H8V9M15 7H19C19.6 7 20 7.4 20 8V16C20 16.6 19.6 17 19 17H15C14.4 17 14 16.6 14 16V8C14 7.4 14.4 7 15 7M16 9V15H18V9M12 11C12.6 11 13 10.6 13 10C13 9.4 12.6 9 12 9C11.4 9 11 9.4 11 10C11 10.6 11.4 11 12 11M12 15C12.6 15 13 14.6 13 14C13 13.4 12.6 13 12 13C11.4 13 11 13.4 11 14C11 14.6 11.4 15 12 15Z",thermometer:"M15 13V5A3 3 0 0 0 9 5V13A5 5 0 1 0 15 13M12 4A1 1 0 0 1 13 5V8H11V5A1 1 0 0 1 12 4Z",humidity:"M12,3.25C12,3.25 6,10 6,14C6,17.32 8.69,20 12,20A6,6 0 0,0 18,14C18,10 12,3.25 12,3.25M14.47,9.97L15.53,11.03L9.53,17.03L8.47,15.97M9.75,10A1.25,1.25 0 0,1 11,11.25A1.25,1.25 0 0,1 9.75,12.5A1.25,1.25 0 0,1 8.5,11.25A1.25,1.25 0 0,1 9.75,10M14.25,14.5A1.25,1.25 0 0,1 15.5,15.75A1.25,1.25 0 0,1 14.25,17A1.25,1.25 0 0,1 13,15.75A1.25,1.25 0 0,1 14.25,14.5Z",link:"M19,10L17,12L19,14L21,12M14.88,16.29L13,18.17V14.41M13,5.83L14.88,7.71L13,9.58M17.71,7.71L12,2H11V9.58L6.41,5L5,6.41L10.59,12L5,17.58L6.41,19L11,14.41V22H12L17.71,16.29L13.41,12M7,12L5,10L3,12L5,14L7,12Z",linkOff:"M13,5.83L14.88,7.71L13.28,9.31L14.69,10.72L17.71,7.7L12,2H11V7.03L13,9.03M5.41,4L4,5.41L10.59,12L5,17.59L6.41,19L11,14.41V22H12L16.29,17.71L18.59,20L20,18.59M13,18.17V14.41L14.88,16.29",nightMode:"M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95M17.33,17.97C14.5,17.81 11.7,16.64 9.53,14.5C7.36,12.31 6.2,9.5 6.04,6.68C3.23,9.82 3.34,14.64 6.35,17.66C9.37,20.67 14.19,20.78 17.33,17.97Z",volumeHigh:"M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z",volumeOff:"M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z",lock:"M12,17C10.89,17 10,16.1 10,15C10,13.89 10.89,13 12,13A2,2 0 0,1 14,15A2,2 0 0,1 12,17M18,20V10H6V20H18M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10C4,8.89 4.89,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z",reminder:"M10 21H14C14 22.1 13.1 23 12 23S10 22.1 10 21M21 19V20H3V19L5 17V11C5 7.9 7 5.2 10 4.3V4C10 2.9 10.9 2 12 2S14 2.9 14 4V4.3C17 5.2 19 7.9 19 11V17L21 19M17 11C17 8.2 14.8 6 12 6S7 8.2 7 11V18H17V11Z",alarm:"M12,20A7,7 0 0,1 5,13A7,7 0 0,1 12,6A7,7 0 0,1 19,13A7,7 0 0,1 12,20M12,4A9,9 0 0,0 3,13A9,9 0 0,0 12,22A9,9 0 0,0 21,13A9,9 0 0,0 12,4M12.5,8H11V14L15.75,16.85L16.5,15.62L12.5,13.25V8M7.88,3.39L6.6,1.86L2,5.71L3.29,7.24L7.88,3.39M22,5.72L17.4,1.86L16.11,3.39L20.71,7.25L22,5.72Z",clock:"M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z",playlist:"M3 10H14V12H3V10M3 6H14V8H3V6M3 14H10V16H3V14M16 13V21L22 17L16 13Z",dotsGrid:"M12 16C13.1 16 14 16.9 14 18S13.1 20 12 20 10 19.1 10 18 10.9 16 12 16M12 10C13.1 10 14 10.9 14 12S13.1 14 12 14 10 13.1 10 12 10.9 10 12 10M12 4C13.1 4 14 4.9 14 6S13.1 8 12 8 10 7.1 10 6 10.9 4 12 4M6 16C7.1 16 8 16.9 8 18S7.1 20 6 20 4 19.1 4 18 4.9 16 6 16M6 10C7.1 10 8 10.9 8 12S7.1 14 6 14 4 13.1 4 12 4.9 10 6 10M6 4C7.1 4 8 4.9 8 6S7.1 8 6 8 4 7.1 4 6 4.9 4 6 4M18 16C19.1 16 20 16.9 20 18S19.1 20 18 20 16 19.1 16 18 16.9 16 18 16M18 10C19.1 10 20 10.9 20 12S19.1 14 18 14 16 13.1 16 12 16.9 10 18 10M18 4C19.1 4 20 4.9 20 6S19.1 8 18 8 16 7.1 16 6 16.9 4 18 4Z",drag:"M9,3H11V5H9V3M13,3H15V5H13V3M9,7H11V9H9V7M13,7H15V9H13V7M9,11H11V13H9V11M13,11H15V13H13V11M9,15H11V17H9V15M13,15H15V17H13V15M9,19H11V21H9V19M13,19H15V21H13V19Z",zoomIn:"M9,2A7,7 0 0,1 16,9C16,10.57 15.5,12 14.61,13.19L15.41,14H16L22,20L20,22L14,16V15.41L13.19,14.61C12,15.5 10.57,16 9,16A7,7 0 0,1 2,9A7,7 0 0,1 9,2M8,5V8H5V10H8V13H10V10H13V8H10V5H8Z",zoomOut:"M9,2A7,7 0 0,1 16,9C16,10.57 15.5,12 14.61,13.19L15.41,14H16L22,20L20,22L14,16V15.41L13.19,14.61C12,15.5 10.57,16 9,16A7,7 0 0,1 2,9A7,7 0 0,1 9,2M5,8V10H13V8H5Z",grid:"M10,4V8H14V4H10M16,4V8H20V4H16M16,10V14H20V10H16M16,16V20H20V16H16M14,20V16H10V20H14M8,20V16H4V20H8M8,14V10H4V14H8M8,8V4H4V8H8M10,14H14V10H10V14M4,2H20A2,2 0 0,1 22,4V20A2,2 0 0,1 20,22H4C2.92,22 2,21.1 2,20V4A2,2 0 0,1 4,2Z",restore:"M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z",refresh:"M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z",library:"M21,17H7V3H21M21,1H7A2,2 0 0,0 5,3V17A2,2 0 0,0 7,19H21A2,2 0 0,0 23,17V3A2,2 0 0,0 21,1M3,5H1V21A2,2 0 0,0 3,23H19V21H3M15.96,10.29L13.21,13.83L11.25,11.47L8.5,15H19.5L15.96,10.29Z",text:"M9.62,12L12,5.67L14.37,12M11,3L5.5,17H7.75L8.87,14H15.12L16.25,17H18.5L13,3H11Z"};function m(r){return Be`<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d=${Vr[r]}></path></svg>`}var zr=900,ge=class extends g{constructor(){super();this._hold=me;this._settled=!1;this._rafId=null;this._lastTs=0;this._settleTimer=void 0;this._onPointerDown=e=>{this.disabled||this._settled||(e.currentTarget.setPointerCapture(e.pointerId),e.preventDefault(),this._hold=_i(),wt("light"),this._startLoop())};this._onPointerUp=()=>this._release();this._onPointerLeave=()=>this._release();this.label="Hold to confirm",this.completeLabel="Done",this.disabled=!1,this.danger=!1,this.config=fi}disconnectedCallback(){super.disconnectedCallback(),this._stopLoop(),clearTimeout(this._settleTimer)}updated(e){e.has("disabled")&&this.disabled&&this._reset()}_reset(){this._stopLoop(),this._hold=me,this._settled=!1,this.requestUpdate()}_stopLoop(){this._rafId!==null&&cancelAnimationFrame(this._rafId),this._rafId=null}_startLoop(){if(this._rafId!==null)return;this._lastTs=performance.now();let e=t=>{let s=t-this._lastTs;this._lastTs=t;let n=this._hold.phase;if(this._hold=bi(this._hold,s,this.config),this.requestUpdate(),n==="charging"&&this._hold.phase==="completed"&&this._onCompleted(),this._hold.phase==="idle"||this._hold.phase==="completed"){this._rafId=null;return}this._rafId=requestAnimationFrame(e)};this._rafId=requestAnimationFrame(e)}_onCompleted(){this._settled=!0,wt("success"),this.dispatchEvent(new CustomEvent("confirmed",{bubbles:!0,composed:!0})),this._settleTimer=setTimeout(()=>{this._hold=me,this._settled=!1,this.requestUpdate()},zr)}_release(){this._hold.phase==="charging"&&(this._hold=vi(this._hold),this._startLoop())}render(){let e=yi(this._hold,this.config),t=We(),s=this._settled;return l`
      <button
        type="button"
        class="hold ${this.danger?"danger":""} ${t?"reduced":""}"
        ?disabled=${this.disabled}
        aria-label=${s?this.completeLabel:this.label}
        @pointerdown=${this._onPointerDown}
        @pointerup=${this._onPointerUp}
        @pointercancel=${this._onPointerUp}
        @pointerleave=${this._onPointerLeave}
      >
        <span class="fill" style="transform: scaleX(${e})"></span>
        <span class="content">
          <span class="ring">
            ${s?m("check"):Be`<svg viewBox="0 0 24 24" width="20" height="20">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.5" />
                  <circle
                    cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-dasharray=${2*Math.PI*9}
                    stroke-dashoffset=${2*Math.PI*9*(1-e)}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)"
                  />
                </svg>`}
          </span>
          <span class="label">${s?this.completeLabel:this.label}</span>
        </span>
      </button>
    `}};ge.properties={label:{type:String},completeLabel:{type:String,attribute:"complete-label"},disabled:{type:Boolean},danger:{type:Boolean},config:{attribute:!1}},ge.styles=[y,_`
    :host {
      display: block;
    }
    .hold {
      position: relative;
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--divider-color);
      background: color-mix(in srgb, var(--primary-text-color) 6%, transparent);
      color: var(--primary-text-color);
      overflow: hidden;
      cursor: pointer;
      padding: 0;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .hold:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .hold:focus-visible {
      outline: 2px solid var(--lu-accent);
      outline-offset: 2px;
    }
    .fill {
      position: absolute;
      inset: 0;
      background: var(--lu-accent);
      transform-origin: left center;
      transform: scaleX(0);
      pointer-events: none;
    }
    .hold:not(.reduced) .fill {
      transition: transform 60ms linear;
    }
    .hold.danger .fill {
      background: var(--lu-danger);
    }
    .content {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 700;
    }
    .ring {
      display: inline-flex;
      color: var(--lu-accent);
      flex: none;
    }
    .hold.danger .ring {
      color: var(--lu-danger);
    }
    `];customElements.define("iledclock-hold-button",ge);function $t(r){let i=Math.max(0,Math.min(255,Math.round(r)));return i>=238?15:i<=47?0:Math.floor((i-47)/14)+1}function kt(r){let i=Math.max(0,Math.min(255,Math.round(r)));return Math.min(15,Math.floor(i/16))}function J(r){return Math.max(0,Math.min(15,Math.round(r)))*17}function Nr(r){return[$t(r[0]),$t(r[1]),$t(r[2])]}function Br(r){return[kt(r[0]),kt(r[1]),kt(r[2])]}function ee(r){let[i,e,t]=Nr(r);return[J(i),J(e),J(t)]}function xi(r){let[i,e,t]=Br(r);return[J(i),J(e),J(t)]}function fe(r){let i=e=>Math.max(0,Math.min(255,Math.round(e)));return[i(r[0]),i(r[1]),i(r[2])]}function O(r){let i=e=>Math.max(0,Math.min(255,Math.round(e))).toString(16).padStart(2,"0");return`#${i(r[0])}${i(r[1])}${i(r[2])}`}function F(r){let i=r.replace("#",""),e=i.length===3?i.split("").map(s=>s+s).join(""):i,t=Number.parseInt(e,16);return Number.isNaN(t)||e.length!==6?[0,0,0]:[t>>16&255,t>>8&255,t&255]}function Ke(r){return r?{type:"iledclock/designs/list",entry_id:r}:{type:"iledclock/designs/list"}}function wi(r){return{type:"iledclock/designs/save",design:r}}function $i(r){return{type:"iledclock/designs/delete",design_id:r}}function te(r,i){return{type:"iledclock/render",entry_id:r,spec:i}}function H(r,i){return{type:"iledclock/show",entry_id:r,item:i}}function ki(r){return{type:"iledclock/playlist/get",entry_id:r}}function Si(r,i){return{type:"iledclock/playlist/set",entry_id:r,playlist:i}}function Ze(r,i,e={}){return{type:"iledclock/command",entry_id:r,command:i,params:e}}var Gr=1,jr=3600,Ur=["clock","date","text","design","timer","scoreboard","temperature","humidity"];function St(r){return Math.max(Gr,Math.min(jr,Math.round(r)))}function Ci(r,i){return r.filter(e=>Ur.includes(e.kind)).slice(0,Math.max(0,i)).map(e=>({...e,duration_s:St(e.duration_s)}))}var qr=255;function _e(r,i,e={}){let t=r.trim();if(t.length===0)return null;let s={type:"text",text:t,color:fe(i)};return e.font&&(s.font=e.font),e.effect&&(s.effect=e.effect),e.speed!==void 0&&(s.speed=Math.max(0,Math.min(qr,Math.round(e.speed)))),s}function Ct(r,i,e,t){return{type:"clock",style:Math.max(1,Math.min(t,Math.round(r))),color:fe(i),h24:e}}var Ei=["M","T","W","T","F","S","S"],Wr=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];function Et(r,i){return(r&1<<i)!==0}function Li(r,i){return r^1<<i}function Mi(r){if(r===0)return"Once";if(r===127)return"Every day";if(r===31)return"Weekdays";let i=[];for(let e=0;e<7;e++)Et(r,e)&&i.push(Wr[e]);return i.join(", ")}function M(r){if(r instanceof Error)return r.message;if(r&&typeof r=="object"&&"message"in r){let i=r.message;if(typeof i=="string"&&i)return i}return"Something went wrong."}function Ai(r,i){if(!i)return null;let e=r.states[i];if(!e)return null;let t=Number(e.state);return Number.isNaN(t)?null:{value:t,min:Number(e.attributes.min??0),max:Number(e.attributes.max??100),step:Number(e.attributes.step??1)}}var Kr=-1,be=class extends g{constructor(){super(),this.state=null,this.open=!1,this._password="",this._busy=null,this._error=null}updated(i){i.has("open")&&this.open&&(this._error=null)}async _command(i,e){if(!(!this.entryId||!this.hass.callWS)){this._busy=i,this._error=null;try{await this.hass.callWS(Ze(this.entryId,i,e))}catch(t){this._error=M(t)}finally{this._busy=null,this.requestUpdate()}}}_setNumberEntity(i,e){this.hass.callService("number","set_value",{value:e},{entity_id:i})}_selectOption(i,e){this.hass.callService("select","select_option",{option:e},{entity_id:i})}_toggleSwitch(i){this.hass.callService("switch","toggle",{},{entity_id:i})}_pressButton(i){this.hass.callService("button","press",{},{entity_id:i})}_close(){this.dispatchEvent(new CustomEvent("close-requested",{bubbles:!0,composed:!0}))}_onKeydown(i){i.key==="Escape"&&this._close()}render(){return this.open?l`
      <div class="backdrop" @click=${this._close}></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Clock settings" @keydown=${this._onKeydown}>
        <header>
          <h2>Settings</h2>
          <button type="button" class="icon-button" @click=${this._close} aria-label="Close">${m("close")}</button>
        </header>
        <div class="body">
          ${this._error?l`<p class="error">${this._error}</p>`:c}
          ${this._renderNightMode()}
          ${this._renderAlarms()}
          ${this._renderTimerSwitches()}
          ${this._renderReminders()}
          ${this._renderDeviceSection()}
          ${this._renderPassword()}
          ${this.entities.deviceId?l`<button type="button" class="link-row" @click=${this._openDevicePage}>Open device page ${m("chevronRight")}</button>`:c}
        </div>
      </div>
    `:c}_renderNightMode(){let i=this.state?.night_mode??{enabled:!1,start_h:22,start_m:0,end_h:7,end_m:0,device_off:!1,brightness:20,wake_minutes:5,voice:!1,voice_sensitivity:3},e=`${String(i.start_h).padStart(2,"0")}:${String(i.start_m).padStart(2,"0")}`,t=`${String(i.end_h).padStart(2,"0")}:${String(i.end_m).padStart(2,"0")}`,s=n=>this._command("night_mode_set",{...i,...n});return l`
      <section>
        <h3>Night mode</h3>
        <button type="button" class="toggle-row" @click=${()=>s({enabled:!i.enabled})}>
          <span class="toggle-icon">${m("nightMode")}</span>
          <span class="toggle-label">Enabled</span>
          ${this._renderPill(i.enabled)}
        </button>
        ${i.enabled?l`
              <div class="row two-up">
                <label>Starts<input type="time" .value=${e} @change=${n=>this._applyTime(n,(o,a)=>s({start_h:o,start_m:a}))} /></label>
                <label>Ends<input type="time" .value=${t} @change=${n=>this._applyTime(n,(o,a)=>s({end_h:o,end_m:a}))} /></label>
              </div>
              <button type="button" class="toggle-row" @click=${()=>s({device_off:!i.device_off})}>
                <span class="toggle-label">Turn display off</span>
                ${this._renderPill(i.device_off)}
              </button>
              ${i.device_off?c:l`<label class="field">Brightness during night mode ${this._renderStepperInline(i.brightness,1,100,5,n=>s({brightness:n}))}</label>`}
              <label class="field">Wake for ${i.wake_minutes} min on motion ${this._renderStepperInline(i.wake_minutes,0,60,1,n=>s({wake_minutes:n}))}</label>
              <button type="button" class="toggle-row" @click=${()=>s({voice:!i.voice})}>
                <span class="toggle-label">Wake on voice</span>
                ${this._renderPill(i.voice)}
              </button>
              ${i.voice?l`<label class="field">Voice sensitivity ${this._renderStepperInline(i.voice_sensitivity,1,5,1,n=>s({voice_sensitivity:n}))}</label>`:c}
            `:c}
      </section>
    `}_applyTime(i,e){let t=i.target.value,[s,n]=t.split(":").map(Number);s===void 0||n===void 0||Number.isNaN(s)||Number.isNaN(n)||e(s,n)}_renderPill(i){return l`<span class="toggle-pill ${i?"on":""}"><span class="toggle-knob"></span></span>`}_renderStepperInline(i,e,t,s,n){return l`
      <span class="inline-stepper">
        <button type="button" class="step-btn small" ?disabled=${i<=e} @click=${()=>n(Math.max(e,i-s))}>&minus;</button>
        <span class="step-value">${i}</span>
        <button type="button" class="step-btn small" ?disabled=${i>=t} @click=${()=>n(Math.min(t,i+s))}>&plus;</button>
      </span>
    `}_renderAlarms(){let i=this.state?.alarms??[],e=t=>this._command("alarms_set",{items:t});return l`
      <section>
        <h3>Alarms</h3>
        ${i.length===0?l`<p class="hint">No alarms set.</p>`:c}
        ${i.map(t=>this._renderAlarmRow(t,i,e))}
        <button type="button" class="add-row" @click=${()=>e([...i,{id:Kr--,hour:7,minute:0,enabled:!0,repeat:0}])}>
          ${m("plus")} Add alarm
        </button>
      </section>
    `}_renderAlarmRow(i,e,t){let s=`${String(i.hour).padStart(2,"0")}:${String(i.minute).padStart(2,"0")}`,n=o=>t(e.map(a=>a.id===i.id?{...a,...o}:a));return l`
      <div class="entry-row">
        <input
          type="time"
          .value=${s}
          @change=${o=>this._applyTime(o,(a,d)=>n({hour:a,minute:d}))}
        />
        ${this._renderRepeatChips(i.repeat,o=>n({repeat:o}))}
        <button type="button" class="mini-toggle ${i.enabled?"on":""}" @click=${()=>n({enabled:!i.enabled})} aria-label="Enabled">
          ${m("check")}
        </button>
        <button type="button" class="icon-button" @click=${()=>t(e.filter(o=>o.id!==i.id))} aria-label="Delete alarm">${m("delete")}</button>
      </div>
    `}_renderRepeatChips(i,e){return l`
      <span class="repeat-chips" title=${Mi(i)}>
        ${Ei.map((t,s)=>l`<button type="button" class="day-chip ${Et(i,s)?"on":""}" @click=${()=>e(Li(i,s))}>${t}</button>`)}
      </span>
    `}_renderTimerSwitches(){let i=this.state?.timer_switches??[],e=t=>this._command("timer_switch_set",{items:t});return l`
      <section>
        <h3>Timer switches</h3>
        <p class="hint">Turns the display on or off automatically.</p>
        ${i.length===0?l`<p class="hint">None set.</p>`:c}
        ${i.map(t=>{let s=`${String(t.hour).padStart(2,"0")}:${String(t.minute).padStart(2,"0")}`,n=o=>e(i.map(a=>a.index===t.index?{...a,...o}:a));return l`
            <div class="entry-row">
              <input type="time" .value=${s} @change=${o=>this._applyTime(o,(a,d)=>n({hour:a,minute:d}))} />
              <iledclock-segmented-picker
                group-label="Action"
                content-fit
                .options=${[{value:"on",label:"On"},{value:"off",label:"Off"}]}
                .value=${t.on?"on":"off"}
                @option-selected=${o=>n({on:o.detail.value==="on"})}
              ></iledclock-segmented-picker>
              ${this._renderRepeatChips(t.repeat,o=>n({repeat:o}))}
              <button type="button" class="mini-toggle ${t.enabled?"on":""}" @click=${()=>n({enabled:!t.enabled})} aria-label="Enabled">${m("check")}</button>
              <button type="button" class="icon-button" @click=${()=>e(i.filter(o=>o.index!==t.index))} aria-label="Delete">${m("delete")}</button>
            </div>
          `})}
        ${i.length<4?l`<button type="button" class="add-row" @click=${()=>{let t=new Set(i.map(n=>n.index)),s=0;for(;t.has(s);)s++;e([...i,{index:s,hour:22,minute:0,on:!1,enabled:!0,repeat:0}])}}>${m("plus")} Add timer switch</button>`:c}
      </section>
    `}_renderReminders(){let i=this.state?.reminders??[];return i.length===0?c:l`
      <section>
        <h3>Reminders</h3>
        <p class="hint">Created from the clock itself; delete them here.</p>
        ${i.map(e=>l`
          <div class="entry-row">
            <span class="reminder-content">${e.content||"(untitled)"}</span>
            <span class="reminder-time">${String(e.hour).padStart(2,"0")}:${String(e.minute).padStart(2,"0")}</span>
            <button type="button" class="icon-button" @click=${()=>this._command("reminder_delete",{id:e.id})} aria-label="Delete reminder">${m("delete")}</button>
          </div>
        `)}
      </section>
    `}_renderDeviceSection(){let i=this.entities.rotationSelect,e=i?this.hass.states[i]:void 0,t=Ai(this.hass,this.entities.volumeNumber),s=Ai(this.hass,this.entities.colorSpeedNumber);return!i&&!t&&!s&&this.entities.settingSwitches.length===0?c:l`
      <section>
        <h3>Device</h3>
        ${i&&e?l`
              <label class="field">
                Rotation
                <select @change=${n=>this._selectOption(i,n.target.value)}>
                  ${(e.attributes.options??[]).map(n=>l`<option value=${n} ?selected=${n===e.state}>${n}</option>`)}
                </select>
              </label>
            `:c}
        ${t?l`<label class="field">Volume ${this._renderStepperInline(t.value,t.min,t.max,t.step,n=>this._setNumberEntity(this.entities.volumeNumber,n))}</label>`:c}
        ${s?l`<label class="field">Colour speed ${this._renderStepperInline(s.value,s.min,s.max,s.step,n=>this._setNumberEntity(this.entities.colorSpeedNumber,n))}</label>`:c}
        ${this.entities.settingSwitches.map(n=>{let o=this.hass.states[n.entityId]?.state==="on";return l`
            <button type="button" class="toggle-row" @click=${()=>this._toggleSwitch(n.entityId)}>
              <span class="toggle-label">${n.name}</span>
              ${this._renderPill(o)}
            </button>
          `})}
        ${this.entities.syncTimeButton?l`<button type="button" class="cloud-toggle" @click=${()=>this._pressButton(this.entities.syncTimeButton)}>Sync time now</button>`:c}
      </section>
    `}_renderPassword(){return l`
      <section>
        <h3>Password</h3>
        <p class="hint">Required by the clock before it accepts any command -- keep it in sync here if you change it on the device itself.</p>
        <input type="password" class="password-input" .value=${this._password} placeholder="New password" @input=${i=>this._password=i.target.value} />
        <iledclock-hold-button
          label="Hold to set password"
          complete-label="Password set"
          ?disabled=${this._password.length===0||this._busy==="set_password"}
          @confirmed=${this._setPassword}
        ></iledclock-hold-button>
      </section>
    `}async _setPassword(){let i=this._password;await this._command("set_password",{password:i}),this._error||(this._password="")}_openDevicePage(){history.pushState(null,"",`/config/devices/device/${this.entities.deviceId}`),window.dispatchEvent(new CustomEvent("location-changed",{bubbles:!0,composed:!0})),this._close()}};be.properties={hass:{attribute:!1},entities:{attribute:!1},entryId:{attribute:!1},state:{attribute:!1},open:{type:Boolean,reflect:!0},_password:{state:!0},_busy:{state:!0},_error:{state:!0}},be.styles=[y,_`
    :host(:not([open])) {
      display: none;
    }
    :host {
      position: fixed;
      inset: 0;
      z-index: 100;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
    }
    .panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: min(420px, 100vw);
      background: var(--lu-card);
      color: var(--lu-ink);
      box-shadow: var(--lu-shadow-raised);
      border-left: 1px solid var(--lu-edge);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid var(--divider-color);
      position: sticky;
      top: 0;
      background: inherit;
      z-index: 1;
    }
    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }
    .icon-button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--primary-text-color);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-button:hover {
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    }
    .body {
      padding: 8px 16px 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    section {
      padding: 12px 0;
      border-bottom: 1px solid var(--divider-color);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    section:last-of-type {
      border-bottom: none;
    }
    h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .row.two-up {
      display: flex;
      gap: 12px;
    }
    .row.two-up label {
      flex: 1;
    }
    label.field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 14px;
      gap: 12px;
    }
    label.field input,
    label.field select,
    .row.two-up input {
      margin-top: 4px;
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 10px;
      box-sizing: border-box;
      font-size: 14px;
    }
    .row.two-up label {
      display: flex;
      flex-direction: column;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    select {
      appearance: auto;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      padding: 6px 0;
      min-height: var(--lu-target, 48px);
      color: var(--primary-text-color);
      cursor: pointer;
      text-align: left;
      font-size: 14px;
    }
    .toggle-icon {
      display: inline-flex;
      color: var(--secondary-text-color);
    }
    .toggle-label {
      flex: 1;
    }
    .toggle-pill {
      flex: none;
      width: 40px;
      height: 24px;
      border-radius: var(--lu-radius-pill);
      background: color-mix(in srgb, var(--primary-text-color) 20%, transparent);
      position: relative;
      transition: background 0.15s ease;
    }
    .toggle-pill.on {
      background: var(--lu-accent);
    }
    .toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.15s ease;
    }
    .toggle-pill.on .toggle-knob {
      transform: translateX(16px);
    }
    .inline-stepper {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .step-btn.small {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 16px;
      cursor: pointer;
    }
    .step-btn.small:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .step-value {
      min-width: 2em;
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .entry-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .entry-row input[type="time"] {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 8px;
    }
    iledclock-segmented-picker {
      width: 100px;
    }
    .repeat-chips {
      display: inline-flex;
      gap: 3px;
    }
    .day-chip {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: color-mix(in srgb, var(--primary-text-color) 10%, transparent);
      color: var(--primary-text-color);
      font-size: 11px;
      cursor: pointer;
    }
    .day-chip.on {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
    }
    .mini-toggle {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid var(--divider-color);
      background: transparent;
      color: transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .mini-toggle.on {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      border-color: transparent;
    }
    .add-row {
      display: flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 1px dashed var(--divider-color);
      border-radius: var(--lu-radius-control);
      min-height: var(--lu-target, 48px);
      color: var(--primary-text-color);
      cursor: pointer;
      justify-content: center;
      font-size: 14px;
    }
    .reminder-content {
      flex: 1;
      font-size: 14px;
    }
    .reminder-time {
      font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color);
      font-size: 13px;
    }
    .password-input {
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 12px;
      box-sizing: border-box;
      font-size: 14px;
    }
    .cloud-toggle {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-text-color);
      cursor: pointer;
      font-size: 14px;
    }
    .link-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: none;
      border: none;
      min-height: var(--lu-target, 48px);
      color: var(--primary-text-color);
      cursor: pointer;
      font-size: 14px;
      padding: 8px 0;
    }
  `];customElements.define("iledclock-settings-sheet",be);var Zr=[{name:"device_id",required:!0,selector:{device:{filter:{integration:"iledclock"}}}},{name:"name",selector:{text:{}}}],Yr={device_id:"iLedClock device",name:"Name (optional)"},ve=class extends g{constructor(){super(...arguments);this._computeLabel=e=>Yr[e.name]??e.name}setConfig(e){this._config=e}render(){return this._config?customElements.get("ha-form")?l`
        <ha-form .hass=${this.hass} .data=${this._config} .schema=${Zr} .computeLabel=${this._computeLabel} @value-changed=${this._formValueChanged}></ha-form>
      `:this._renderFallback():c}_renderFallback(){let e=Object.values(this.hass?.entities??{}),t=Object.values(this.hass?.devices??{}).filter(s=>e.some(n=>n.device_id===s.id&&n.platform==="iledclock"));return l`
      <div class="fallback">
        <label>
          <span>iLedClock device</span>
          <select @change=${s=>this._updateDeviceId(s.target.value)}>
            <option value="" ?selected=${!this._config?.device_id}>Choose a device…</option>
            ${t.map(s=>l`<option value=${s.id} ?selected=${s.id===this._config?.device_id}>${s.name_by_user??s.name}</option>`)}
          </select>
        </label>
        <label>
          <span>Name (optional)</span>
          <input type="text" .value=${this._config?.name??""} @change=${s=>this._updateName(s.target.value)} />
        </label>
      </div>
    `}_updateDeviceId(e){this._config&&(this._config={...this._config,device_id:e},this._fireConfigChanged())}_updateName(e){this._config&&(this._config={...this._config,name:e||void 0},this._fireConfigChanged())}_formValueChanged(e){this._config=e.detail.value,this._fireConfigChanged()}_fireConfigChanged(){this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:this._config},bubbles:!0,composed:!0}))}};ve.properties={hass:{attribute:!1},_config:{state:!0}},ve.styles=[y,_`
    .fallback {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px 0;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 14px;
      color: var(--primary-text-color);
    }
    select,
    input {
      min-height: 40px;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 10px;
      font-size: 14px;
    }
    `];customElements.define("iledclock-card-editor",ve);var Xr={display:{domain:"light",translationKeys:["display"],idSuffixes:["_display"]},message:{domain:"text",translationKeys:["message"],idSuffixes:["_message"]},preview:{domain:"image",translationKeys:["display"],idSuffixes:["_display"]},temperature:{domain:"sensor",translationKeys:["temperature"],idSuffixes:["_temperature"]},humidity:{domain:"sensor",translationKeys:["humidity"],idSuffixes:["_humidity"]},firmware:{domain:"sensor",translationKeys:["firmware"],idSuffixes:["_firmware"]},programCount:{domain:"sensor",translationKeys:["program_count"],idSuffixes:["_program_count"]},connected:{domain:"binary_sensor",translationKeys:["connected"],idSuffixes:["_connected"]},syncTimeButton:{domain:"button",translationKeys:["sync_time"],idSuffixes:["_sync_time"]},rotationSelect:{domain:"select",translationKeys:["rotation"],idSuffixes:["_rotation"]},clockFaceSelect:{domain:"select",translationKeys:["clock_face"],idSuffixes:["_clock_face"]},volumeNumber:{domain:"number",translationKeys:["volume"],idSuffixes:["_volume"]},colorSpeedNumber:{domain:"number",translationKeys:["color_speed"],idSuffixes:["_color_speed"]},nightModeSwitch:{domain:"switch",translationKeys:["night_mode"],idSuffixes:["_night_mode"]}};function Ii(r){return r.slice(0,r.indexOf("."))}function Ti(r){return r.slice(r.indexOf(".")+1)}function Qr(r,i){if(Ii(r.entity_id)!==i.domain)return!1;if(r.translation_key&&i.translationKeys.includes(r.translation_key))return!0;let e=Ti(r.entity_id);return i.idSuffixes.some(t=>e.endsWith(t))}function Jr(r){let i=r.name??r.original_name;if(i)return i;let e=Ti(r.entity_id).split("_").filter(Boolean).pop();return e?e[0].toUpperCase()+e.slice(1):"Setting"}function Pi(r,i){let e={deviceId:i,settingSwitches:[]},t=Object.values(r).filter(s=>s.device_id===i&&!s.disabled_by);for(let s of t){let n=!1;for(let o of Object.entries(Xr)){let[a,d]=o;if(!e[a]&&Qr(s,d)){e[a]=s.entity_id,n=!0;break}}!n&&Ii(s.entity_id)==="switch"&&e.settingSwitches.push({entityId:s.entity_id,name:Jr(s)})}return e.settingSwitches.sort((s,n)=>s.name.localeCompare(n.name)),e}function Ye(r,i){if(i)return r[i]?.config_entries?.[0]}function Hi(r){return Math.max(1,Math.min(100,Math.round(r/255*100)))}function Ri(r){return Math.max(1,Math.min(255,Math.round(r/100*255)))}var es=[...Array.from({length:35},(r,i)=>i+1),37,38,39,40,41],Lt=41,ye=es.map(r=>({style:r,label:"Face "+r})),z=[{index:0,label:"Red",rgb:[255,0,0]},{index:1,label:"Magenta",rgb:[255,0,255]},{index:2,label:"Yellow",rgb:[255,255,0]},{index:3,label:"Green",rgb:[0,255,0]},{index:4,label:"Cyan",rgb:[0,255,255]},{index:5,label:"Blue",rgb:[0,0,255]},{index:6,label:"White",rgb:[255,255,255]},{index:7,label:"Black",rgb:[0,0,0]}];var ts={1:"Solid",2:"Rainbow",3:"Fade",4:"Per-letter rainbow",5:"Per-letter fade"},is=28,Di=Array.from({length:is},(r,i)=>{let e=i+1;return{mode:e,label:ts[e]??`Effect ${e}`}});function N(r,i){if(r.length<=1)return 0;let e=r.reduce((s,n)=>s+Math.max(1,n.durationMs),0),t=(i%e+e)%e;for(let s=0;s<r.length;s++){let n=Math.max(1,r[s].durationMs);if(t<n)return s;t-=n}return r.length-1}function rs(r){let i="";for(let t=0;t<r.pixels.length;t+=8192)i+=String.fromCharCode(...r.pixels.subarray(t,t+8192));return btoa(i)}function xe(r,i,e,t){let s=atob(r),n=new Uint8Array(i*e*3),o=Math.min(s.length,n.length);for(let a=0;a<o;a++)n[a]=s.charCodeAt(a);return{width:i,height:e,pixels:n,durationMs:t}}function T(r){return r.frames.length===0?[P(r.width,r.height)]:r.frames.map((i,e)=>xe(i,r.width,r.height,r.delays[e]??100))}function Oi(r,i){return{id:i.id,name:i.name,kind:i.kind,width:r[0]?.width??32,height:r[0]?.height??16,frames:r.map(rs),delays:r.map(e=>e.durationMs),created:i.created,updated:i.updated,tags:i.tags}}var ss=[{value:"clock",label:"Clock"},{value:"text",label:"Text"},{value:"art",label:"Art"},{value:"timer",label:"Timer"},{value:"score",label:"Score"}],ns=[{value:"countdown",label:"Countdown"},{value:"stopwatch",label:"Stopwatch"},{value:"pomodoro",label:"Pomodoro"}],os=6e4,as=400,we=class extends g{constructor(){super();this._unsubscribe=null;this._heroStartedAt=0;this._heroRafId=null;this._designsWatchKey="";this._entities={deviceId:"",settingSwitches:[]},this._envelope=null,this._mode="clock",this._settingsOpen=!1,this._heroFrames=[P()],this._heroApproximate=!1,this._designs=null,this._designsLoading=!1,this._clockFaceIndex=1,this._clockColorIndex=6,this._clock24h=!0,this._textMessage="",this._textColorHex="#ffffff",this._textEffect=1,this._textSpeed=80,this._selectedDesignId=null,this._timerTab="countdown",this._countdownDraft={h:0,m:5,s:0},this._tomatoDraft=[25],this._busy=null,this._error=null}setConfig(e){if(!e.device_id)throw new Error("iLedClock card: a device is required. Choose it in the card editor.");this._config=e}getCardSize(){return 6}static getStubConfig(e){return{type:"custom:iledclock-card",device_id:Object.values(e.entities??{}).find(s=>s.platform==="iledclock")?.device_id??""}}static getConfigElement(){return document.createElement("iledclock-card-editor")}connectedCallback(){super.connectedCallback(),this._startHeroLoop(),this._idleClockTimer=setInterval(()=>{(this._mode==="clock"||this._heroFrames.length<=1&&this._heroApproximate)&&this._refreshIdleClockPreview()},os)}disconnectedCallback(){super.disconnectedCallback(),this._stopHeroLoop(),clearInterval(this._idleClockTimer),clearTimeout(this._textDebounceTimer),this._unsubscribe&&this._unsubscribe()}willUpdate(e){if((e.has("hass")||e.has("_config"))&&this.hass&&this._config?.device_id){this._entities=Pi(this.hass.entities,this._config.device_id);let t=Ye(this.hass.devices,this._config.device_id);this._entryId=t,t&&t!==this._lastEntryIdSubscribed&&(this._lastEntryIdSubscribed=t,this._connect(t))}e.has("_mode")&&this._mode==="art"&&this._loadDesigns()}async _connect(e){if(this._unsubscribe&&(this._unsubscribe(),this._unsubscribe=null),!!this.hass.callWS){try{this._envelope=await this.hass.callWS({type:"iledclock/state",entry_id:e})}catch{}this._heroApproximate||this._refreshIdleClockPreview(),this.hass.connection&&(this._unsubscribe=await this.hass.connection.subscribeMessage(t=>{t.type!=="upload"&&(this._envelope=t)},{type:"iledclock/subscribe",entry_id:e}))}}_startHeroLoop(){if(this._heroRafId!==null)return;this._heroStartedAt=performance.now();let e=()=>{this.requestUpdate("_heroFrames"),this._heroRafId=requestAnimationFrame(e)};this._heroRafId=requestAnimationFrame(e)}_stopHeroLoop(){this._heroRafId!==null&&cancelAnimationFrame(this._heroRafId),this._heroRafId=null}_currentHeroFrame(){let e=performance.now()-this._heroStartedAt,t=N(this._heroFrames,e);return this._heroFrames[t]??P()}async _refreshIdleClockPreview(){if(!this._entryId||!this.hass.callWS)return;let e=Ct(this._clockFaceIndex,z[this._clockColorIndex]?.rgb??[255,255,255],this._clock24h,Lt);await this._loadHeroPreview(e,!0)}async _loadHeroPreview(e,t){if(!(!this._entryId||!this.hass.callWS))try{let s=await this.hass.callWS(te(this._entryId,e)),n=(this._entities,32),o=s.frames.map((a,d)=>{let p=atob(a),u=new Uint8Array(n*16*3);for(let h=0;h<Math.min(p.length,u.length);h++)u[h]=p.charCodeAt(h);return{width:n,height:16,pixels:u,durationMs:s.delays[d]??100}});o.length>0&&(this._heroFrames=o,this._heroApproximate=t&&!!s.approximate,this._heroStartedAt=performance.now())}catch{}}_selectMode(e){if(this._mode=e,e==="art"&&this._selectedDesignId){let t=this._designs?.find(s=>s.id===this._selectedDesignId);t&&(this._heroFrames=T(t),this._heroStartedAt=performance.now())}}_toggleDisplay(){let e=this._entities.display;if(!e)return;let t=this.hass.states[e]?.state==="on";this.hass.callService("light",t?"turn_off":"turn_on",{},{entity_id:e})}_setBrightnessPercent(e){let t=this._entities.display;t&&this.hass.callService("light","turn_on",{brightness:Ri(e)},{entity_id:t})}_sendClock(){if(!this._entryId||!this.hass.callWS)return;let e=Ct(this._clockFaceIndex,z[this._clockColorIndex]?.rgb??[255,255,255],this._clock24h,Lt);this._runCommand("show-clock",()=>this.hass.callWS(H(this._entryId,{spec:e}))),this._loadHeroPreview(e,!1)}_onTextInput(e){this._textMessage=e,clearTimeout(this._textDebounceTimer),this._textDebounceTimer=setTimeout(()=>this._previewText(),as)}_previewText(){let e=_e(this._textMessage,F(this._textColorHex),{effect:String(this._textEffect),speed:this._textSpeed});e&&this._loadHeroPreview(e,!1)}_sendText(){if(!this._entryId||!this.hass.callWS)return;let e=_e(this._textMessage,F(this._textColorHex),{effect:String(this._textEffect),speed:this._textSpeed});e&&this._runCommand("show-text",()=>this.hass.callWS(H(this._entryId,{spec:e})))}async _loadDesigns(){let e=`${this._entryId??""}`;if(!(this._designsWatchKey===e&&this._designs)&&(this._designsWatchKey=e,!!this.hass.callWS)){this._designsLoading=!0;try{this._designs=await this.hass.callWS(Ke(this._entryId))}catch{this._designs=[]}finally{this._designsLoading=!1}}}_selectDesign(e){this._selectedDesignId=e.id,this._heroFrames=T(e),this._heroStartedAt=performance.now()}_sendDesign(){!this._entryId||!this._selectedDesignId||!this.hass.callWS||this._runCommand("show-design",()=>this.hass.callWS(H(this._entryId,{design_id:this._selectedDesignId})))}_openStudio(){history.pushState(null,"","/iledclock"),window.dispatchEvent(new CustomEvent("location-changed",{bubbles:!0,composed:!0}))}_runCommand(e,t){this._busy=e,this._error=null,t().catch(s=>{this._error=s instanceof Error?s.message:"Something went wrong."}).finally(()=>{this._busy=null,this.requestUpdate()})}_command(e,t={}){!this._entryId||!this.hass.callWS||this._runCommand(e,()=>this.hass.callWS(Ze(this._entryId,e,t)))}_adjustScore(e,t){let s=this._envelope?.state.scoreboard,n=Math.max(0,(s?.home??0)+(e==="home"?t:0)),o=Math.max(0,(s?.away??0)+(e==="away"?t:0));this._command("scoreboard_set_score",{home:n,away:o})}render(){if(!this._config)return c;let e=this._envelope?.state??null;return l`
      <ha-card>
        <div class="container">
          <div class="root">
            <div class="hero-wrap">
              <iledclock-matrix-canvas .frame=${this._currentHeroFrame()} bloom></iledclock-matrix-canvas>
              ${this._heroApproximate?l`<span class="approximate-badge">Preview</span>`:c}
              <div class="hero-corner left">
                ${this._entities.display?l`
                      <button type="button" class="chip icon-chip" @click=${this._toggleDisplay} aria-label="Toggle display">
                        ${m("power")}
                      </button>
                      <input
                        class="brightness-slider"
                        type="range"
                        min="1"
                        max="100"
                        .value=${String(Hi(Number(this.hass.states[this._entities.display]?.attributes.brightness??128)))}
                        @input=${t=>this._setBrightnessPercent(Number(t.target.value))}
                        aria-label="Brightness"
                      />
                    `:c}
              </div>
              <button type="button" class="chip icon-chip hero-corner right" @click=${()=>this._settingsOpen=!0} aria-label="Settings">
                ${m("cog")}
              </button>
              <div class="status-pills">${this._renderStatusPills(e)}</div>
            </div>
            <div class="controls">
              <iledclock-segmented-picker
                group-label="Mode"
                .options=${ss}
                .value=${this._mode}
                @option-selected=${t=>this._selectMode(t.detail.value)}
              ></iledclock-segmented-picker>
              ${this._error?l`<p class="error">${this._error}</p>`:c}
              <div class="mode-panel">
                ${this._mode==="clock"?this._renderClockPanel():c}
                ${this._mode==="text"?this._renderTextPanel():c}
                ${this._mode==="art"?this._renderArtPanel():c}
                ${this._mode==="timer"?this._renderTimerPanel(e):c}
                ${this._mode==="score"?this._renderScorePanel(e):c}
              </div>
            </div>
          </div>
        </div>
      </ha-card>
      <iledclock-settings-sheet
        .hass=${this.hass}
        .entities=${this._entities}
        .entryId=${this._entryId}
        .state=${e}
        ?open=${this._settingsOpen}
        @close-requested=${()=>this._settingsOpen=!1}
      ></iledclock-settings-sheet>
    `}_renderStatusPills(e){let t=[];if(this._entities.connected){let s=this._envelope?.connected??this.hass.states[this._entities.connected]?.state==="on";t.push(l`<span class="pill ${s?"good":"warn"}"><span class="dot"></span>${s?"Connected":"Offline"}</span>`)}return e?.night_mode?.enabled&&t.push(l`<span class="pill night">${m("nightMode")} Night mode</span>`),e?.temperature!=null&&t.push(l`<span class="pill">${m("thermometer")} ${e.temperature}\u00b0</span>`),e?.humidity!=null&&t.push(l`<span class="pill">${m("humidity")} ${e.humidity}%</span>`),t}_renderClockPanel(){return l`
      <div class="panel-section">
        <div class="face-grid">
          ${ye.map(e=>l`<button type="button" class="face-btn ${e.style===this._clockFaceIndex?"selected":""}" @click=${()=>(this._clockFaceIndex=e.style,this._refreshIdleClockPreview())}>
              ${e.style}
            </button>`)}
        </div>
        <div class="swatch-row">
          ${z.map(e=>l`<button
              type="button"
              class="swatch ${e.index===this._clockColorIndex?"selected":""}"
              style="background:${`rgb(${xi(e.rgb).join(",")})`}"
              aria-label=${e.label}
              @click=${()=>(this._clockColorIndex=e.index,this._refreshIdleClockPreview())}
            ></button>`)}
        </div>
        <iledclock-segmented-picker
          group-label="Hour format"
          content-fit
          .options=${[{value:"24",label:"24h"},{value:"12",label:"12h"}]}
          .value=${this._clock24h?"24":"12"}
          @option-selected=${e=>(this._clock24h=e.detail.value==="24",this._refreshIdleClockPreview())}
        ></iledclock-segmented-picker>
        <button type="button" class="primary-action" ?disabled=${this._busy==="show-clock"} @click=${this._sendClock}>Set clock face</button>
      </div>
    `}_renderTextPanel(){return l`
      <div class="panel-section">
        <input class="text-input" type="text" maxlength="64" placeholder="Message" .value=${this._textMessage} @input=${e=>this._onTextInput(e.target.value)} />
        <div class="swatch-row">
          <input type="color" class="color-input" .value=${this._textColorHex} @input=${e=>(this._textColorHex=e.target.value,this._previewText())} />
          <select class="effect-select" @change=${e=>(this._textEffect=Number(e.target.value),this._previewText())}>
            ${Di.map(e=>l`<option value=${e.mode} ?selected=${e.mode===this._textEffect}>${e.label}</option>`)}
          </select>
        </div>
        <label class="field-label">
          Speed
          <input type="range" min="0" max="255" .value=${String(this._textSpeed)} @input=${e=>(this._textSpeed=Number(e.target.value),this._previewText())} />
        </label>
        <button type="button" class="primary-action" ?disabled=${this._busy==="show-text"||this._textMessage.trim().length===0} @click=${this._sendText}>Send</button>
      </div>
    `}_renderArtPanel(){return l`
      <div class="panel-section">
        ${this._designsLoading?l`<p class="hint">Loading designs…</p>`:c}
        ${!this._designsLoading&&(this._designs?.length??0)===0?l`<p class="hint">No saved designs yet. Open the studio to create one.</p>`:c}
        <div class="carousel">
          ${(this._designs??[]).map(e=>{let t=T(e)[0];return l`
              <button type="button" class="carousel-item ${e.id===this._selectedDesignId?"selected":""}" @click=${()=>this._selectDesign(e)}>
                <span class="carousel-thumb"><iledclock-matrix-canvas .frame=${t}></iledclock-matrix-canvas></span>
                <span class="carousel-label">${e.name}</span>
              </button>
            `})}
        </div>
        <div class="button-row">
          <button type="button" class="primary-action" ?disabled=${this._busy==="show-design"||!this._selectedDesignId} @click=${this._sendDesign}>Send</button>
          <button type="button" class="secondary-action" @click=${this._openStudio}>Open studio</button>
        </div>
      </div>
    `}_renderTimerPanel(e){return l`
      <div class="panel-section">
        <iledclock-segmented-picker
          group-label="Timer type"
          content-fit
          .options=${ns}
          .value=${this._timerTab}
          @option-selected=${t=>this._timerTab=t.detail.value}
        ></iledclock-segmented-picker>
        ${this._timerTab==="countdown"?this._renderCountdown(e):c}
        ${this._timerTab==="stopwatch"?this._renderStopwatch(e):c}
        ${this._timerTab==="pomodoro"?this._renderPomodoro(e):c}
      </div>
    `}_renderCountdown(e){let t=e?.countdown,s=this._countdownDraft;return l`
      <div class="timer-display">${this._formatHms(t?.hours??s.h,t?.minutes??s.m,t?.seconds??s.s)}</div>
      <div class="hms-inputs">
        ${this._renderHmsField("h",s.h,0,23)}
        ${this._renderHmsField("m",s.m,0,59)}
        ${this._renderHmsField("s",s.s,0,59)}
      </div>
      <div class="button-row">
        <button type="button" class="secondary-action" @click=${()=>this._command("countdown_reset",{h:s.h,m:s.m,s:s.s})}>Reset</button>
        <button type="button" class="primary-action" @click=${()=>this._command("countdown_run",{start:!t?.running})}>${t?.running?"Stop":"Start"}</button>
      </div>
    `}_renderStopwatch(e){let t=e?.stopwatch;return l`
      <div class="timer-display">${this._formatHms(t?.hours??0,t?.minutes??0,t?.seconds??0)}</div>
      <div class="button-row">
        <button type="button" class="secondary-action" @click=${()=>this._command("stopwatch_reset")}>Reset</button>
        <button type="button" class="primary-action" @click=${()=>this._command("stopwatch_run",{start:!t?.running})}>${t?.running?"Stop":"Start"}</button>
      </div>
    `}_renderPomodoro(e){let t=e?.tomato?.minutes??this._tomatoDraft;return l`
      <div class="tomato-list">
        ${t.map((s,n)=>l`
            <span class="tomato-chip">
              ${s}m
              <button type="button" class="chip-remove" @click=${()=>this._tomatoDraft=t.filter((o,a)=>a!==n)} aria-label="Remove">${m("close")}</button>
            </span>
          `)}
        ${t.length<6?l`<button type="button" class="chip-add" @click=${()=>this._tomatoDraft=[...t,25]}>${m("plus")}</button>`:c}
      </div>
      <button type="button" class="primary-action" @click=${()=>this._command("tomato_set",{minutes:t})}>Set</button>
    `}_renderHmsField(e,t,s,n){return l`
      <label class="hms-field">
        ${e.toUpperCase()}
        <input
          type="number"
          min=${s}
          max=${n}
          .value=${String(t)}
          @input=${o=>this._countdownDraft={...this._countdownDraft,[e]:Math.max(s,Math.min(n,Number(o.target.value)))}}
        />
      </label>
    `}_formatHms(e,t,s){return`${String(e).padStart(2,"0")}:${String(t).padStart(2,"0")}:${String(s).padStart(2,"0")}`}_renderScorePanel(e){let t=e?.scoreboard;return l`
      <div class="panel-section">
        <div class="score-row">
          <div class="score-side">
            <span class="score-label">Home</span>
            <span class="score-value">${t?.home??0}</span>
            <div class="score-buttons">
              <button type="button" class="step-btn" @click=${()=>this._adjustScore("home",-1)}>&minus;</button>
              <button type="button" class="step-btn" @click=${()=>this._adjustScore("home",1)}>&plus;</button>
            </div>
          </div>
          <div class="score-side">
            <span class="score-label">Away</span>
            <span class="score-value">${t?.away??0}</span>
            <div class="score-buttons">
              <button type="button" class="step-btn" @click=${()=>this._adjustScore("away",-1)}>&minus;</button>
              <button type="button" class="step-btn" @click=${()=>this._adjustScore("away",1)}>&plus;</button>
            </div>
          </div>
        </div>
        <div class="timer-display">${this._formatMs(t?.minutes??0,t?.seconds??0)}</div>
        <div class="button-row">
          <button type="button" class="secondary-action" @click=${()=>this._command("scoreboard_set_time",{m:10,s:0,count_down:!0})}>Reset time</button>
          <button type="button" class="primary-action" @click=${()=>this._command("scoreboard_run",{start:!t?.running})}>${t?.running?"Stop":"Start"}</button>
        </div>
      </div>
    `}_formatMs(e,t){return`${String(e).padStart(2,"0")}:${String(t).padStart(2,"0")}`}};we.properties={hass:{attribute:!1},_config:{state:!0},_entities:{state:!0},_entryId:{state:!0},_envelope:{state:!0},_mode:{state:!0},_settingsOpen:{state:!0},_heroFrames:{state:!0},_heroApproximate:{state:!0},_designs:{state:!0},_designsLoading:{state:!0},_clockFaceIndex:{state:!0},_clockColorIndex:{state:!0},_clock24h:{state:!0},_textMessage:{state:!0},_textColorHex:{state:!0},_textEffect:{state:!0},_textSpeed:{state:!0},_selectedDesignId:{state:!0},_timerTab:{state:!0},_countdownDraft:{state:!0},_tomatoDraft:{state:!0},_busy:{state:!0},_error:{state:!0}},we.styles=[y,_`
    :host {
      display: block;
    }
    .container {
      container-type: inline-size;
    }
    .root {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .hero-wrap {
      position: relative;
      aspect-ratio: 2 / 1;
      border-radius: calc(var(--ha-card-border-radius, 12px) - 2px);
      overflow: hidden;
      background: #050607;
    }
    .approximate-badge {
      position: absolute;
      left: 8px;
      bottom: 8px;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: var(--lu-radius-pill);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
    }
    .hero-corner {
      position: absolute;
      top: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .hero-corner.left {
      left: 8px;
    }
    button.hero-corner.right {
      right: 8px;
      top: 8px;
    }
    .chip {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      cursor: pointer;
    }
    .brightness-slider {
      width: 90px;
      accent-color: var(--lu-accent);
    }
    .status-pills {
      position: absolute;
      right: 8px;
      bottom: 8px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--lu-radius-pill);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-size: 12px;
      font-weight: 600;
    }
    .pill svg {
      width: 14px;
      height: 14px;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--lu-positive);
    }
    .pill.warn .dot {
      background: var(--lu-danger);
    }
    .pill.night {
      color: var(--lu-ink-2);
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .mode-panel {
      min-height: 0;
    }
    .panel-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .face-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
      gap: 6px;
      max-height: 132px;
      overflow-y: auto;
      padding: 2px;
    }
    .face-btn {
      min-height: 40px;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .face-btn {
      transition: transform 90ms var(--lu-ease, ease), background-color 150ms ease;
    }
    .face-btn:active {
      transform: scale(0.97);
    }
    .face-btn.selected {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      border-color: transparent;
      font-weight: 700;
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .swatch-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .swatch {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
    }
    .swatch.selected {
      border-color: var(--primary-text-color);
    }
    .color-input {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      overflow: hidden;
      padding: 0;
      background: none;
      cursor: pointer;
    }
    .effect-select {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 8px;
    }
    .field-label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .field-label input[type="range"] {
      accent-color: var(--lu-accent);
    }
    .text-input {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 12px;
      font-size: 15px;
      box-sizing: border-box;
    }
    .primary-action,
    .secondary-action {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      flex: 1;
    }
    .primary-action {
      border: none;
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      transition: transform 90ms var(--lu-ease, ease);
    }
    .primary-action:active:not(:disabled) {
      transform: scale(0.97);
    }
    .primary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .secondary-action {
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-text-color);
    }
    .button-row {
      display: flex;
      gap: 10px;
    }
    .carousel {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding: 2px;
      scroll-snap-type: x proximity;
    }
    .carousel-item {
      flex: none;
      width: 96px;
      border: 2px solid transparent;
      border-radius: var(--lu-radius-tile);
      background: none;
      cursor: pointer;
      scroll-snap-align: start;
      padding: 4px;
    }
    .carousel-item {
      transition: transform 90ms var(--lu-ease, ease), border-color 150ms ease;
    }
    .carousel-item:active {
      transform: scale(0.97);
    }
    .carousel-item.selected {
      border-color: var(--lu-accent);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .carousel-thumb {
      display: block;
      aspect-ratio: 2 / 1;
      border-radius: var(--lu-radius-control);
      overflow: hidden;
    }
    .carousel-label {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      color: var(--primary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .timer-display {
      font-size: 34px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
      color: var(--primary-text-color);
    }
    .hms-inputs {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .hms-field {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 12px;
      color: var(--secondary-text-color);
      gap: 4px;
    }
    .hms-field input {
      width: 56px;
      min-height: var(--lu-target, 48px);
      text-align: center;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 16px;
    }
    .tomato-list {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .tomato-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 6px 6px 12px;
      border-radius: var(--lu-radius-pill);
      background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      font-size: 13px;
      font-weight: 600;
    }
    .chip-remove,
    .chip-add {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--secondary-text-color);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .chip-add {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border: 1px dashed var(--divider-color);
      color: var(--primary-text-color);
    }
    .score-row {
      display: flex;
      gap: 16px;
    }
    .score-side {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .score-label {
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .score-value {
      font-size: 40px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .score-buttons {
      display: flex;
      gap: 8px;
    }
    .step-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: 2px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      font-size: 22px;
      cursor: pointer;
    }
    @container (min-width: 560px) {
      .root {
        flex-direction: row;
        align-items: flex-start;
      }
      .hero-wrap {
        flex: 1 1 58%;
      }
      .controls {
        flex: 1 1 42%;
      }
    }
  `];customElements.define("iledclock-card",we);window.customCards=window.customCards||[];window.customCards.push({type:"iledclock-card",name:"iLedClock",description:"Control and preview an iLedClock 32x16 RGB BLE pixel clock."});function Fi(r,i,e,t,s=!1){if(!Q(r,i,e))return r;let n=V(r,i,e),o=ee(t);if(n[0]===o[0]&&n[1]===o[1]&&n[2]===o[2])return r;let a=C(r),d=new Uint8Array(r.width*r.height),p=[[i,e]];for(;p.length>0;){let[u,h]=p.pop();if(!Q(r,u,h))continue;let b=h*r.width+u;if(d[b])continue;let f=V(r,u,h);if(f[0]!==n[0]||f[1]!==n[1]||f[2]!==n[2])continue;d[b]=1,k(a,u,h,o);let v=s?[[(u+1)%r.width,h],[(u-1+r.width)%r.width,h],[u,(h+1)%r.height],[u,(h-1+r.height)%r.height]]:[[u+1,h],[u-1,h],[u,h+1],[u,h-1]];for(let x of v)p.push(x)}return a}function Vi(r,i,e,t,s,n,o=ee){let a=C(r),d=o(n),p=Math.abs(t-i),u=-Math.abs(s-e),h=i<t?1:-1,b=e<s?1:-1,f=p+u,v=i,x=e;for(;k(a,v,x,d),!(v===t&&x===s);){let $=2*f;$>=u&&(f+=u,v+=h),$<=p&&(f+=p,x+=b)}return a}function zi(r,i,e,t,s,n,o,a=ee){let d=C(r),p=a(n),u=Math.min(i,t),h=Math.max(i,t),b=Math.min(e,s),f=Math.max(e,s);for(let v=b;v<=f;v++)for(let x=u;x<=h;x++)(o||v===b||v===f||x===u||x===h)&&k(d,x,v,p);return d}function Ni(r,i,e,t,s,n,o,a=ee){let d=C(r),p=a(n),u=Math.min(i,t),h=Math.max(i,t),b=Math.min(e,s),f=Math.max(e,s),v=(u+h)/2,x=(b+f)/2,$=(h-u)/2,A=(f-b)/2;if($<.5||A<.5){for(let w=u;w<=h;w++)for(let S=b;S<=f;S++)k(d,w,S,p);return d}let at=w=>{let S=1-w*w/(A*A);return S<=0?0:$*Math.sqrt(S)};for(let w=-Math.ceil(A);w<=Math.ceil(A);w++){let S=at(w),Z=Math.round(x+w),re=Math.round(v+S),Bt=Math.round(v-S);if(o)for(let lt=Bt;lt<=re;lt++)k(d,lt,Z,p);else k(d,Bt,Z,p),k(d,re,Z,p)}if(!o)for(let w=-Math.ceil($);w<=Math.ceil($);w++){let S=1-w*w/($*$),Z=S<=0?0:A*Math.sqrt(S),re=Math.round(v+w);k(d,re,Math.round(x+Z),p),k(d,re,Math.round(x-Z),p)}return d}var ls=[{tool:"pen",icon:"pen",label:"Pen"},{tool:"eraser",icon:"eraser",label:"Eraser"},{tool:"fill",icon:"fill",label:"Fill"},{tool:"line",icon:"line",label:"Line"},{tool:"rectangle",icon:"rectangle",label:"Rectangle"},{tool:"ellipse",icon:"ellipse",label:"Ellipse"},{tool:"eyedropper",icon:"eyedropper",label:"Eyedropper"},{tool:"text",icon:"textStamp",label:"Text stamp"},{tool:"shift",icon:"shift",label:"Shift"}],Bi=[100,150,200,300,400],$e=class extends g{constructor(){super();this._dragStart=null;this._onMatrixPointer=e=>{if(this.disabled)return;let{x:t,y:s,phase:n}=e.detail;if(n!=="leave"&&!(t<0||s<0))switch(this._tool){case"pen":case"eraser":{let o=this._tool==="eraser"?[0,0,0]:this.activeColor;if(n==="down"){this._draft=qe(this.frame,t,s,o);return}if(!this._draft)return;let a=qe(this._draft,t,s,o);this._draft=a,n==="up"&&(this._emitFrame(a),this._draft=null);return}case"fill":{if(n!=="down")return;this._emitFrame(Fi(this.frame,t,s,this.activeColor,this.wrap));return}case"eyedropper":{if(n!=="down")return;this._pickColor(V(this.frame,t,s));return}case"text":{if(n!=="down")return;this._stampTextAt(t,s);return}case"line":case"rectangle":case"ellipse":{if(n==="down"){this._dragStart=[t,s],this._draft=this.frame;return}if(!this._dragStart)return;let[o,a]=this._dragStart,d=this._tool==="line"?Vi(this.frame,o,a,t,s,this.activeColor):this._tool==="rectangle"?zi(this.frame,o,a,t,s,this.activeColor,this._filled):Ni(this.frame,o,a,t,s,this.activeColor,this._filled);this._draft=d,n==="up"&&(this._emitFrame(d),this._draft=null,this._dragStart=null);return}case"shift":{if(n==="down"){this._dragStart=[t,s],this._draft=this.frame;return}if(!this._dragStart)return;let[o,a]=this._dragStart,d=ui(this.frame,t-o,s-a,this.wrap);this._draft=d,n==="up"&&(this._emitFrame(d),this._draft=null,this._dragStart=null);return}}};this.wrap=!1,this.activeColor=[255,255,255],this.recentColors=[],this.disabled=!1,this._tool="pen",this._filled=!1,this._zoomIndex=0,this._draft=null,this._textArmed=!1,this._textValue="",this._busy=!1}updated(e){e.has("frame")&&(this._draft=null)}_emitFrame(e){this.dispatchEvent(new CustomEvent("frame-changed",{detail:{frame:e},bubbles:!0,composed:!0}))}_pickColor(e){this.dispatchEvent(new CustomEvent("color-picked",{detail:{color:e},bubbles:!0,composed:!0}))}_selectTool(e){this._tool=e,this._textArmed=e==="text"}_onMirror(e){this._emitFrame(pi(this.frame,e))}_onUndo(){this.dispatchEvent(new CustomEvent("undo-requested",{bubbles:!0,composed:!0}))}_onRedo(){this.dispatchEvent(new CustomEvent("redo-requested",{bubbles:!0,composed:!0}))}_zoomIn(){this._zoomIndex=Math.min(Bi.length-1,this._zoomIndex+1)}_zoomOut(){this._zoomIndex=Math.max(0,this._zoomIndex-1)}async _stampTextAt(e,t){let s=this._textValue.trim();if(!s||!this.hass?.callWS||!this.entryId)return;let n=_e(s,this.activeColor);if(n){this._busy=!0;try{let a=(await this.hass.callWS(te(this.entryId,n))).frames[0];if(!a)return;let d=atob(a),p=C(this.frame),u=this.frame.width,h=this.frame.height;for(let b=0;b<h;b++)for(let f=0;f<u;f++){let v=(b*u+f)*3,x=d.charCodeAt(v)||0,$=d.charCodeAt(v+1)||0,A=d.charCodeAt(v+2)||0;if(x===0&&$===0&&A===0)continue;let at=e+f-Math.floor(u/2),w=t+b-Math.floor(h/2);p=qe(p,at,w,[x,$,A])}this._emitFrame(p)}finally{this._busy=!1,this._textArmed=!1}}}render(){let e=Bi[this._zoomIndex],t=this._draft??this.frame;return l`
      <div class="toolbar">
        ${ls.map(s=>l`
            <button
              type="button"
              class="tool-btn ${this._tool===s.tool?"selected":""}"
              ?disabled=${this.disabled||s.tool==="text"&&(!this.hass?.callWS||!this.entryId)}
              @click=${()=>this._selectTool(s.tool)}
              aria-label=${s.label}
              title=${s.label}
            >
              ${m(s.icon)}
            </button>
          `)}
        ${this._tool==="rectangle"||this._tool==="ellipse"?l`<button type="button" class="tool-btn ${this._filled?"selected":""}" @click=${()=>this._filled=!this._filled} title="Filled">${m("check")}</button>`:c}
        <button type="button" class="tool-btn" @click=${()=>this._onMirror("horizontal")} title="Mirror horizontal">${m("flipH")}</button>
        <button type="button" class="tool-btn" @click=${()=>this._onMirror("vertical")} title="Mirror vertical">${m("flipV")}</button>
        <button type="button" class="tool-btn" @click=${this._onUndo} title="Undo">${m("undo")}</button>
        <button type="button" class="tool-btn" @click=${this._onRedo} title="Redo">${m("redo")}</button>
        <span class="zoom-group">
          <button type="button" class="tool-btn" @click=${this._zoomOut} title="Zoom out">${m("zoomOut")}</button>
          <span class="zoom-value">${e}%</span>
          <button type="button" class="tool-btn" @click=${this._zoomIn} title="Zoom in">${m("zoomIn")}</button>
        </span>
      </div>
      ${this._textArmed?l`<input class="text-stamp-input" type="text" placeholder="Type, then tap the canvas" .value=${this._textValue} @input=${s=>this._textValue=s.target.value} />`:c}
      <div class="canvas-scroll">
        <div class="canvas-wrap" style="width: ${e}%">
          <iledclock-matrix-canvas .frame=${t} interactive show-grid @matrix-pointer=${this._onMatrixPointer}></iledclock-matrix-canvas>
        </div>
      </div>
      <div class="palette">
        ${this.recentColors.map(s=>l`<button type="button" class="swatch" style="background:${`rgb(${s.join(",")})`}" @click=${()=>this._pickColor(s)} aria-label="Recent colour"></button>`)}
        <input class="color-input" type="color" .value=${O(this.activeColor)} @input=${s=>this._pickColor(F(s.target.value))} />
      </div>
    `}};$e.properties={frame:{attribute:!1},onionSkin:{attribute:!1},wrap:{type:Boolean},activeColor:{attribute:!1},recentColors:{attribute:!1},hass:{attribute:!1},entryId:{attribute:"entry-id"},disabled:{type:Boolean},_tool:{state:!0},_filled:{state:!0},_zoomIndex:{state:!0},_draft:{state:!0},_textArmed:{state:!0},_textValue:{state:!0},_busy:{state:!0}},$e.styles=[y,_`
    :host {
      display: block;
      container-type: inline-size;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .tool-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: none;
      background: var(--lu-tile);
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      transition: transform 90ms var(--lu-ease, ease), opacity 90ms var(--lu-ease, ease);
    }
    .tool-btn.selected {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .tool-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .tool-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .zoom-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .zoom-value {
      font-size: 12px;
      color: var(--lu-ink-2);
      min-width: 3.5em;
      text-align: center;
    }
    .text-stamp-input {
      width: 100%;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-accent);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 12px;
      box-sizing: border-box;
      margin-bottom: 8px;
    }
    .canvas-scroll {
      overflow: auto;
      border-radius: var(--lu-radius-tile);
      background: #050607;
    }
    .canvas-wrap {
      aspect-ratio: 2 / 1;
      min-width: 100%;
    }
    .palette {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .swatch {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid var(--lu-edge);
      cursor: pointer;
      padding: 0;
    }
    .color-input {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      overflow: hidden;
      padding: 0;
      background: none;
      cursor: pointer;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
    }
  `];customElements.define("iledclock-pixel-editor",$e);var ds=100,Mt=10,cs=6e4;function Gi(r){return Math.max(Mt,Math.min(cs,Math.round(r)))}function At(r,i,e){let t=e?C(e):P(r[0]?.width,r[0]?.height,[0,0,0],ds),s=Math.max(-1,Math.min(r.length-1,i))+1,n=r.slice();return n.splice(s,0,t),n}function ji(r,i){let e=r[i];return e?At(r,i,e):r.slice()}function Ui(r,i){if(r.length<=1||i<0||i>=r.length)return r.slice();let e=r.slice();return e.splice(i,1),e}function qi(r,i,e){if(i===e||i<0||i>=r.length||e<0||e>=r.length)return r.slice();let t=r.slice(),[s]=t.splice(i,1);return t.splice(e,0,s),t}function Xe(r,i,e){if(r.length===0)return 0;let t=i==="x"?e.clientX:e.clientY;for(let s=0;s<r.length;s++){let n=r[s],o=i==="x"?n.left+n.width:n.top+n.height;if(t<o)return s}return r.length-1}function ke(r,i,e){if(i===e||i<0||i>=r.length||e<0||e>=r.length)return r.slice();let t=r.slice(),[s]=t.splice(i,1);return t.splice(e,0,s),t}var Se=class extends g{constructor(){super();this._dragOriginalIndex=null;this._dragTarget=null;this._itemRefs=new Map;this._rafId=null;this._playStartedAt=0;this.frames=[],this.activeIndex=0,this.playing=!1,this.disabled=!1}disconnectedCallback(){super.disconnectedCallback(),this._stopLoop()}updated(e){e.has("playing")&&(this.playing?this._startLoop():this._stopLoop())}_startLoop(){if(this._rafId!==null)return;this._playStartedAt=performance.now();let e=()=>{let t=N(this.frames,performance.now()-this._playStartedAt);t!==this.activeIndex&&this.dispatchEvent(new CustomEvent("frame-selected",{detail:{index:t},bubbles:!0,composed:!0})),this._rafId=requestAnimationFrame(e)};this._rafId=requestAnimationFrame(e)}_stopLoop(){this._rafId!==null&&cancelAnimationFrame(this._rafId),this._rafId=null}_emitFrames(e){this.dispatchEvent(new CustomEvent("frames-changed",{detail:{frames:e},bubbles:!0,composed:!0}))}_select(e){this.dispatchEvent(new CustomEvent("frame-selected",{detail:{index:e},bubbles:!0,composed:!0}))}_togglePlay(){this.dispatchEvent(new CustomEvent("play-toggled",{detail:{playing:!this.playing},bubbles:!0,composed:!0}))}_onDelayInput(e,t){let s=Gi(Number(t.target.value));this.dispatchEvent(new CustomEvent("delay-changed",{detail:{index:e,delayMs:s},bubbles:!0,composed:!0}))}_onHandlePointerDown(e,t){this.disabled||(t.currentTarget.setPointerCapture(t.pointerId),this._dragOriginalIndex=e,this._dragTarget=e)}_onHandlePointerMove(e){if(this._dragOriginalIndex===null)return;let t=[];for(let n=0;n<this.frames.length;n++){let o=this._itemRefs.get(n);o&&t.push(o.getBoundingClientRect())}let s=Xe(t,"x",e);s!==this._dragTarget&&(this._dragTarget=s,this.requestUpdate())}_onHandlePointerUp(){this._dragOriginalIndex!==null&&(this._dragTarget!==null&&this._dragTarget!==this._dragOriginalIndex&&this._emitFrames(qi(this.frames,this._dragOriginalIndex,this._dragTarget)),this._dragOriginalIndex=null,this._dragTarget=null)}render(){let e=this._dragOriginalIndex!==null&&this._dragTarget!==null?ke(this.frames,this._dragOriginalIndex,this._dragTarget):this.frames;return l`
      <div class="toolbar">
        <button type="button" class="icon-btn" ?disabled=${this.disabled} @click=${this._togglePlay} aria-label=${this.playing?"Pause preview":"Play preview"}>
          ${m(this.playing?"pause":"play")}
        </button>
        <span class="hint">${e.length} frame${e.length===1?"":"s"}</span>
      </div>
      <div class="strip">
        ${e.map((t,s)=>l`
            <div
              class="frame-item ${s===this.activeIndex?"active":""}"
              @pointerdown=${n=>this._onHandlePointerDown(s,n)}
              @pointermove=${this._onHandlePointerMove}
              @pointerup=${this._onHandlePointerUp}
              @pointercancel=${this._onHandlePointerUp}
              ${I(n=>n?this._itemRefs.set(s,n):this._itemRefs.delete(s))}
            >
              <button type="button" class="thumb" @click=${()=>this._select(s)} aria-label="Frame ${s+1}">
                <iledclock-matrix-canvas .frame=${t}></iledclock-matrix-canvas>
              </button>
              <input
                class="delay-input"
                type="number"
                min=${Mt}
                max="60000"
                step="10"
                .value=${String(t.durationMs)}
                @change=${n=>this._onDelayInput(s,n)}
              />
              <div class="row-actions">
                <button type="button" class="icon-btn small" ?disabled=${this.disabled} @click=${()=>this._emitFrames(ji(this.frames,s))} aria-label="Duplicate frame">${m("duplicate")}</button>
                <button type="button" class="icon-btn small" ?disabled=${this.disabled||e.length<=1} @click=${()=>this._emitFrames(Ui(this.frames,s))} aria-label="Delete frame">${m("delete")}</button>
              </div>
            </div>
          `)}
        <button type="button" class="icon-btn add" ?disabled=${this.disabled} @click=${()=>this._emitFrames(At(this.frames,this.frames.length-1))} aria-label="Add frame">
          ${m("plus")}
        </button>
      </div>
    `}};Se.properties={frames:{attribute:!1},activeIndex:{type:Number,attribute:"active-index"},playing:{type:Boolean},disabled:{type:Boolean}},Se.styles=[y,_`
    :host {
      display: block;
      container-type: inline-size;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .hint {
      font-size: 12px;
      color: var(--lu-ink-2);
    }
    .strip {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 4px 2px;
    }
    .frame-item {
      flex: none;
      width: 88px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-radius: var(--lu-radius-tile);
      padding: 4px;
      border: 1px solid transparent;
      touch-action: none;
      transition: opacity 90ms var(--lu-ease, ease);
    }
    .frame-item.active {
      border-color: var(--lu-accent);
      background: var(--lu-tile);
      box-shadow: var(--lu-highlight-raised), var(--lu-shadow-raised);
    }
    .thumb {
      display: block;
      width: 100%;
      aspect-ratio: 2 / 1;
      border-radius: var(--lu-radius-control);
      overflow: hidden;
      border: none;
      padding: 0;
      cursor: pointer;
      transition: transform 90ms var(--lu-ease, ease);
    }
    .thumb:active {
      transform: scale(0.97);
    }
    .delay-input {
      width: 100%;
      min-height: 32px;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      text-align: center;
      font-size: 12px;
      box-sizing: border-box;
    }
    .row-actions {
      display: flex;
      gap: 4px;
      justify-content: center;
    }
    .icon-btn {
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: none;
      background: var(--lu-tile);
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      transition: transform 90ms var(--lu-ease, ease);
    }
    .icon-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .icon-btn.small {
      width: 32px;
      height: 32px;
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .icon-btn.add {
      border: 1px dashed var(--lu-edge);
      background: none;
      align-self: center;
    }
  `];customElements.define("iledclock-frame-timeline",Se);var Ce=class extends g{constructor(){super(),this.designs=[],this.loading=!1,this.disabled=!1,this._renamingId=null}_select(i){this.dispatchEvent(new CustomEvent("design-selected",{detail:{id:i},bubbles:!0,composed:!0}))}_commitRename(i,e){let t=e.target.value.trim();this._renamingId=null,!(!t||t===i.name)&&this.dispatchEvent(new CustomEvent("design-rename-requested",{detail:{id:i.id,name:t},bubbles:!0,composed:!0}))}_duplicate(i){this.dispatchEvent(new CustomEvent("design-duplicate-requested",{detail:{id:i},bubbles:!0,composed:!0}))}_delete(i){this.dispatchEvent(new CustomEvent("design-delete-requested",{detail:{id:i},bubbles:!0,composed:!0}))}render(){return l`
      <div class="header">
        <h2>Library</h2>
        ${this.loading?l`<span class="hint">Loading…</span>`:c}
      </div>
      ${!this.loading&&this.designs.length===0?l`<p class="hint">No saved designs yet. Draw something and save it.</p>`:c}
      <div class="grid">
        ${this.designs.map(i=>{let e=T(i)[0],t=this._renamingId===i.id;return l`
            <div class="tile">
              <button type="button" class="thumb" ?disabled=${this.disabled} @click=${()=>this._select(i.id)} aria-label="Open ${i.name}">
                <iledclock-matrix-canvas .frame=${e}></iledclock-matrix-canvas>
                <span class="kind-badge">${m(i.kind==="animation"?"gif":"image")}</span>
              </button>
              ${t?l`<input class="name-input" .value=${i.name} @blur=${s=>this._commitRename(i,s)} @keydown=${s=>s.key==="Enter"&&s.target.blur()} autofocus />`:l`<button type="button" class="name" @click=${()=>this._renamingId=i.id}>${i.name}</button>`}
              <div class="tile-actions">
                <button type="button" class="icon-btn" ?disabled=${this.disabled} @click=${()=>this._duplicate(i.id)} aria-label="Duplicate">${m("duplicate")}</button>
                <iledclock-hold-button label="Hold to delete" complete-label="Deleted" danger ?disabled=${this.disabled} @confirmed=${()=>this._delete(i.id)}></iledclock-hold-button>
              </div>
            </div>
          `})}
      </div>
    `}};Ce.properties={designs:{attribute:!1},loading:{type:Boolean},disabled:{type:Boolean},_renamingId:{state:!0}},Ce.styles=[y,_`
    :host {
      display: block;
      container-type: inline-size;
      background: var(--lu-tile);
      border-radius: var(--lu-radius-tile);
      padding: 12px;
    }
    .header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 8px;
    }
    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--lu-ink);
    }
    .hint {
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @container (min-width: 420px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    @container (min-width: 700px) {
      .grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .thumb {
      position: relative;
      display: block;
      width: 100%;
      aspect-ratio: 2 / 1;
      border-radius: var(--lu-radius-control);
      overflow: hidden;
      border: 1px solid var(--lu-edge);
      padding: 0;
      cursor: pointer;
      background: none;
    }
    .kind-badge {
      position: absolute;
      right: 4px;
      bottom: 4px;
      display: inline-flex;
      color: #fff;
      background: rgba(0, 0, 0, 0.55);
      border-radius: 50%;
      width: 22px;
      height: 22px;
      align-items: center;
      justify-content: center;
    }
    .name,
    .name-input {
      font-size: 13px;
      color: var(--lu-ink);
      background: none;
      border: none;
      text-align: left;
      padding: 4px 0;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name-input {
      border-bottom: 1px solid var(--lu-accent);
    }
    .tile-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tile-actions iledclock-hold-button {
      flex: 1;
    }
    .icon-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: var(--lu-glass-raised);
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `];customElements.define("iledclock-library-panel",Ce);var us=10;function It(r){throw new Error(`unknown playlist kind: ${String(r)}`)}function Tt(r){return r.charAt(0).toUpperCase()+r.slice(1)}function Ki(r,i=[]){switch(r.kind){case"clock":case"date":return"clock";case"text":return"text";case"design":return i.find(t=>t.id===r.params.design_id)?.kind==="animation"?"gif":"image";case"timer":return r.params.mode==="stopwatch"?"stopwatch":"countdown";case"scoreboard":return"scoreboard";case"temperature":return"thermometer";case"humidity":return"humidity";default:return It(r.kind)}}function Wi(r){let i=r.color;if(!Array.isArray(i)||i.length!==3||i.some(n=>typeof n!="number"))return null;let e=[i[0],i[1],i[2]],t=O(e),s=z.find(n=>O(n.rgb)===t);return s?s.label.toLowerCase():t}function Zi(r,i=[]){switch(r.kind){case"clock":{let e=typeof r.params.style=="number"?r.params.style:null,t=e===null?null:ye.find(o=>o.style===e),s=Wi(r.params),n=[t?t.label:"Custom face",s??"custom colour"];return r.params.h24===!1&&n.push("12-hour"),n.join(", ")}case"date":return Wi(r.params)??"Custom colour";case"text":{let e=typeof r.params.text=="string"?r.params.text.trim():"";if(e.length===0)return"No text yet";let t=typeof r.params.effect=="string"&&r.params.effect.trim()!==""?r.params.effect:null;return t?`\u201C${e}\u201D, ${t.toLowerCase()}`:`\u201C${e}\u201D`}case"design":{let e=i.find(t=>t.id===r.params.design_id);return e?e.name:"No design chosen"}case"timer":return r.params.mode==="stopwatch"?"Stopwatch":"Countdown";case"scoreboard":return"Live scores";case"temperature":return"Live reading";case"humidity":return"Live reading";default:return It(r.kind)}}function ps(r,i=[]){switch(r){case"clock":return{style:ye[0].style,color:[...z[6].rgb]};case"date":return{color:[...z[6].rgb]};case"text":return{text:"Hello"};case"design":return{design_id:i[0]?.id??""};case"timer":return{mode:"countdown"};case"scoreboard":case"temperature":case"humidity":return{};default:return It(r)}}function Yi(r,i=[]){return{kind:r,params:ps(r,i),duration_s:us}}var hs=["clock","date","text","design","timer","scoreboard","temperature","humidity"],Ee=class extends g{constructor(){super();this._dragOriginalIndex=null;this._dragTarget=null;this._itemRefs=new Map;this.items=[],this.maxItems=9,this.designs=[],this.disabled=!1,this._addKind="clock"}_emit(e){this.dispatchEvent(new CustomEvent("items-changed",{detail:{items:e},bubbles:!0,composed:!0}))}_updateDuration(e,t){let s=St(Number(t.target.value)),n=this.items.slice();n[e]={...n[e],duration_s:s},this._emit(n)}_remove(e){this._emit(this.items.filter((t,s)=>s!==e))}_addItem(){this.items.length>=this.maxItems||this._emit([...this.items,Yi(this._addKind,this.designs)])}_onPointerDown(e,t){this.disabled||(t.currentTarget.setPointerCapture(t.pointerId),this._dragOriginalIndex=e,this._dragTarget=e)}_onPointerMove(e){if(this._dragOriginalIndex===null)return;let t=[];for(let n=0;n<this.items.length;n++){let o=this._itemRefs.get(n);o&&t.push(o.getBoundingClientRect())}let s=Xe(t,"y",e);s!==this._dragTarget&&(this._dragTarget=s,this.requestUpdate())}_onPointerUp(){this._dragOriginalIndex!==null&&(this._dragTarget!==null&&this._dragTarget!==this._dragOriginalIndex&&this._emit(ke(this.items,this._dragOriginalIndex,this._dragTarget)),this._dragOriginalIndex=null,this._dragTarget=null)}render(){let e=this._dragOriginalIndex!==null&&this._dragTarget!==null?ke(this.items,this._dragOriginalIndex,this._dragTarget):this.items;return l`
      <div class="header">
        <h2>Playlist</h2>
        <span class="hint">${e.length}/${this.maxItems}</span>
      </div>
      ${e.length===0?l`<p class="hint">Nothing queued -- the clock will just show its clock face.</p>`:c}
      <div class="rows">
        ${e.map((t,s)=>l`
            <div
              class="row"
              @pointerdown=${n=>this._onPointerDown(s,n)}
              @pointermove=${n=>this._onPointerMove(n)}
              @pointerup=${()=>this._onPointerUp()}
              @pointercancel=${()=>this._onPointerUp()}
              ${I(n=>n?this._itemRefs.set(s,n):this._itemRefs.delete(s))}
            >
              <span class="drag-handle">${m("drag")}</span>
              <span class="row-icon">${m(Ki(t,this.designs))}</span>
              <div class="row-text">
                <span class="row-title">${Tt(t.kind)}</span>
                <span class="row-desc">${Zi(t,this.designs)}</span>
              </div>
              <input
                class="duration-input"
                type="number"
                min="1"
                max="3600"
                .value=${String(t.duration_s)}
                @change=${n=>this._updateDuration(s,n)}
              />
              <button type="button" class="icon-btn" ?disabled=${this.disabled} @click=${()=>this._remove(s)} aria-label="Remove">${m("close")}</button>
            </div>
          `)}
      </div>
      <div class="add-row">
        <select class="kind-select" ?disabled=${this.disabled||e.length>=this.maxItems} @change=${t=>this._addKind=t.target.value}>
          ${hs.map(t=>l`<option value=${t} ?selected=${t===this._addKind}>${Tt(t)}</option>`)}
        </select>
        <button type="button" class="add-btn" ?disabled=${this.disabled||e.length>=this.maxItems} @click=${this._addItem}>${m("plus")} Add</button>
      </div>
    `}};Ee.properties={items:{attribute:!1},maxItems:{type:Number,attribute:"max-items"},designs:{attribute:!1},disabled:{type:Boolean},_addKind:{state:!0}},Ee.styles=[y,_`
    :host {
      display: block;
      background: var(--lu-tile);
      border-radius: var(--lu-radius-tile);
      padding: 12px;
    }
    .header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 8px;
    }
    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--lu-ink);
    }
    .hint {
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      border-radius: var(--lu-radius-row);
      background: var(--lu-card);
      touch-action: none;
    }
    .drag-handle {
      color: var(--lu-ink-3);
      flex: none;
    }
    .row-icon {
      color: var(--lu-ink-2);
      flex: none;
    }
    .row-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .row-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--lu-ink);
    }
    .row-desc {
      font-size: 12px;
      color: var(--lu-ink-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .duration-input {
      width: 60px;
      min-height: 36px;
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      text-align: center;
      font-size: 13px;
    }
    .icon-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: none;
      color: var(--lu-ink-2);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .icon-btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .add-row {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .kind-select {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 10px;
    }
    .add-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: none;
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      cursor: pointer;
      padding: 0 16px;
      font-weight: 600;
    }
    .add-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `];customElements.define("iledclock-playlist-editor",Ee);function Le(r){return{past:[],present:r,future:[]}}function Xi(r,i,e=100){if(i===r.present)return r;let t=[...r.past,r.present];for(;t.length>e;)t.shift();return{past:t,present:i,future:[]}}function Qi(r){if(r.past.length===0)return r;let i=r.past[r.past.length-1];return{past:r.past.slice(0,-1),present:i,future:[r.present,...r.future]}}function Ji(r){if(r.future.length===0)return r;let i=r.future[0];return{past:[...r.past,r.present],present:i,future:r.future.slice(1)}}var Qe=[{kind:"life",label:"Life",hint:"Conway's game of life, seeded randomly"},{kind:"fire",label:"Fire",hint:"A rising flame simulation"},{kind:"plasma",label:"Plasma",hint:"Smooth shifting colour fields"},{kind:"matrix",label:"Matrix rain",hint:"Falling green code"},{kind:"starfield",label:"Starfield",hint:"Stars drifting past"},{kind:"rainbow",label:"Rainbow",hint:"A cycling rainbow sweep"},{kind:"sparkle",label:"Sparkle",hint:"Random twinkling pixels"}];var er=["nw","ne","se","sw","n","e","s","w"];function et(r,i,e){let t=Math.max(1,Math.round(i)),s=Math.max(1,Math.round(e)),n=Math.max(1,Math.min(Math.round(r.w),t)),o=Math.max(1,Math.min(Math.round(r.h),s)),a=Math.max(0,Math.min(Math.round(r.x),t-n)),d=Math.max(0,Math.min(Math.round(r.y),s-o));return{x:a,y:d,w:n,h:o}}function Pt(r,i,e=2,t=1){let s=e/t,n=r/Math.max(1,i),o,a;return n>s?(a=i,o=a*s):(o=r,a=o/s),et({x:(r-o)/2,y:(i-a)/2,w:o,h:a},r,i)}function tr(r,i,e,t,s,n){let o=e>0?s/e:1,a=t>0?n/t:1;return{dx:r*o,dy:i*a}}function ir(r,i,e,t,s){return et({...r,x:r.x+i,y:r.y+e},t,s)}function rr(r,i,e,t,s,n){let o=r.x,a=r.y,d=r.x+r.w,p=r.y+r.h,u=Math.max(1,s),h=Math.max(1,n);return i.includes("w")&&(o=Je(o+e,0,d-1)),i.includes("e")&&(d=Je(d+e,o+1,u)),i.includes("n")&&(a=Je(a+t,0,p-1)),i.includes("s")&&(p=Je(p+t,a+1,h)),{x:Math.round(o),y:Math.round(a),w:Math.round(d-o),h:Math.round(p-a)}}function Je(r,i,e){return Math.max(i,Math.min(e,r))}var ms={auto:"Auto",center:"Center",fit:"Fit",fill:"Fill",stretch:"Stretch",tile:"Tile",mirror:"Mirror"};function it(r){let i=ms[r];return i||(r.length===0?r:r.split(/[_-]+/).filter(e=>e.length>0).map(e=>e.charAt(0).toUpperCase()+e.slice(1)).join(" "))}function ar(r){let i=[];for(let e of["auto",...r])i.includes(e)||i.push(e);return i}function lr(r){return typeof r.design_id=="string"}function dr(r,i){return r.url??i?.homepage??void 0}function cr(r){return{type:"iledclock/gallery/sources",entry_id:r}}function ur(r,i){let e={type:"iledclock/gallery/search",entry_id:r,source:i.source,sort:i.sort,page:i.page+1};return i.query&&(e.query=i.query),i.size&&(e.size=i.size),i.animatedOnly&&(e.animated_only=!0),e}function pr(r,i,e,t){let s={type:"iledclock/gallery/preview",entry_id:r,source:i,item_id:e};return t&&Object.keys(t).length>0&&(s.options=t),s}function Ht(r,i,e,t,s){let n={type:"iledclock/gallery/import",entry_id:r,source:i,item_id:e};return t&&Object.keys(t).length>0&&(n.options=t),s&&(n.name=s),n}function Rt(r,i){let e={type:"iledclock/import/file",entry_id:r,filename:i.filename,data_b64:i.dataB64};return i.options&&Object.keys(i.options).length>0&&(e.options=i.options),i.save&&(e.save=!0),i.name&&(e.name=i.name),e}var gs=1,fs=16,sr=512;function _s(r){return Math.max(gs,Math.min(fs,Math.round(r)))}function nr(r){return Math.max(-sr,Math.min(sr,Math.round(r)))}function rt(r,i,e){let t={};return r.layout&&(t.layout=r.layout),r.crop&&(t.crop=et(r.crop,i,e)),r.scale!==void 0&&(t.scale=_s(r.scale)),r.offset&&(t.offset={x:nr(r.offset.x),y:nr(r.offset.y)}),r.background&&(t.background=fe(r.background)),r.enhance!==void 0&&(t.enhance=r.enhance),t}var bs=8*1024*1024,hr=["gif","png","jpg","jpeg","webp"],vs=["aseprite","ase","piskel"],ys=[...hr,...vs];function Dt(r){let i=r.lastIndexOf(".");return i===-1?"":r.slice(i+1).toLowerCase()}function Ot(r){return hr.includes(Dt(r))}function xs(r){return ys.includes(Dt(r))}function Ft(r,i){return xs(r)?i>bs?`${r} is too large (max 8 MB).`:null:`${r||"That file"} isn't a supported type (GIF, PNG, JPEG, WebP, .aseprite, or .piskel).`}var ws={"image/gif":"gif","image/png":"png","image/jpeg":"jpg","image/webp":"webp"};function mr(r,i){let e=ws[i.split(";")[0].trim().toLowerCase()]??"png",t="image";try{let s=new URL(r).pathname,n=s.slice(s.lastIndexOf("/")+1);n&&(t=n)}catch{}return Dt(t)?t:`${t}.${e}`}var or=600,$s=15e3;function ks(r,i){return r!==void 0&&r.expiresAtMs-i>$s}var tt=class{constructor(){this._entries=new Map}async sign(i,e){let t=Date.now(),s=this._entries.get(e);if(ks(s,t))return s.signedPath;if(!i.callWS)return e;try{let n=await i.callWS({type:"auth/sign_path",path:e,expires:or});return this._entries.set(e,{signedPath:n.path,expiresAtMs:t+or*1e3}),n.path}catch{return e}}clear(){this._entries.clear()}};function ie(r){let i=r.find(s=>s.startsWith("auto layout chose "));if(!i)return null;let e=i.slice(18),t=/^majority-pool-x(\d+)$/.exec(e);return t?`Auto: scaled down ${t[1]}x, keeping every pixel edge sharp.`:e.startsWith("center-like")?"Auto: shown pixel for pixel, centred on the clock.":e.startsWith("fit-like")?"Auto: fitted as a photo, colours boosted for the LEDs.":`Auto: ${e}.`}function Vt(r,i){return r.source===i.source&&r.sort===i.sort&&r.query===i.query&&r.size===i.size&&r.animatedOnly===i.animatedOnly}function st(r){return{filters:r,items:[],page:0,hasMore:!0,loading:!1,error:null}}function fr(r,i){let e={...r.filters,...i};return Vt(e,r.filters)?r:st(e)}function _r(r){return r.loading||!r.hasMore?r:{...r,loading:!0,error:null}}function K(r){return`${r.source}:${r.id}`}function br(r,i,e,t){if(!Vt(i,r.filters)||e!==r.page)return r;let s=new Set(r.items.map(o=>K(o))),n=r.items.slice();for(let o of t.items){let a=K(o);s.has(a)||(s.add(a),n.push(o))}return{...r,items:n,page:r.page+1,hasMore:t.has_more,loading:!1,error:null}}function zt(r,i,e,t){return!Vt(i,r.filters)||e!==r.page?r:{...r,loading:!1,error:t}}function vr(r,i){let e=i.trim().toLowerCase();return e?r.filter(t=>t.title.toLowerCase().includes(e)):r}function gr(r){let i=e=>e.endsWith(".0")?e.slice(0,-2):e;return r>=1e6?`${i((r/1e6).toFixed(1))}M`:r>=1e3?`${i((r/1e3).toFixed(1))}k`:String(Math.max(0,Math.round(r)))}function yr(r){let i=[];r.author&&i.push(`by ${r.author}`);let e=[];if(r.likes!=null&&e.push(`${gr(r.likes)} likes`),r.downloads!=null&&e.push(`${gr(r.downloads)} downloads`),e.length>0&&i.push(e.join(" and ")),i.length===0)return null;let t=i.join(", ");return t.charAt(0).toUpperCase()+t.slice(1)}var Nt={visible:!1,pending:null};function xr(r,i,e){return i===r.visible?r.pending===null?r:{...r,pending:null}:r.pending?.toVisible===i?r:{...r,pending:{toVisible:i,sinceMs:e}}}function wr(r,i,e){return r.pending===null||i-r.pending.sinceMs<e?r:{visible:r.pending.toVisible,pending:null}}function $r(r,i,e){return r.visible&&i&&!e}var Ss=250,nt=64,Me=class extends g{constructor(){super();this._pixelFrames=[];this._playStartedAt=0;this._rafId=null;this._requestId=0;this._showOnClock=async()=>{if(!(!this.item||!this.entryId||!this.hass.callWS)){this._saving="show",this._actionError=null;try{let e=await this.hass.callWS(Ht(this.entryId,this.item.source,this.item.id,this._buildOptions()));await this.hass.callWS(H(this.entryId,{design_id:e.design_id})),this.dispatchEvent(new CustomEvent("iledclock-designs-changed",{bubbles:!0,composed:!0})),this.dispatchEvent(new CustomEvent("iledclock-open-design",{detail:{design_id:e.design_id},bubbles:!0,composed:!0})),this._close()}catch(e){this._actionError=M(e)}finally{this._saving=null}}};this.open=!1,this.item=null,this._layout="auto",this._adjustOpen=!1,this._adjust={},this._preview=null,this._previewLoading=!1,this._previewError=null,this._saving=null,this._actionError=null}disconnectedCallback(){super.disconnectedCallback(),this._stopLoop(),clearTimeout(this._debounceTimer)}updated(e){(e.has("open")||e.has("item"))&&(this.open&&this.item?(this._layout="auto",this._adjustOpen=!1,this._adjust={},this._preview=null,this._previewError=null,this._actionError=null,this._pixelFrames=[],this._loadPreview(),this._startLoop()):this._stopLoop()),e.has("_preview")&&(this._pixelFrames=this._preview?this._preview.frames.map((t,s)=>xe(t,32,16,this._preview.delays_ms[s]??100)):[],this._playStartedAt=performance.now())}_startLoop(){if(this._rafId!==null)return;this._playStartedAt=performance.now();let e=()=>{this.requestUpdate(),this._rafId=requestAnimationFrame(e)};this._rafId=requestAnimationFrame(e)}_stopLoop(){this._rafId!==null&&cancelAnimationFrame(this._rafId),this._rafId=null}_currentFrame(){return this._pixelFrames.length===0?null:this._pixelFrames[N(this._pixelFrames,performance.now()-this._playStartedAt)]}_buildOptions(){if(!this.item)return{};let e={...this._adjust};return this._layout!=="auto"&&(e.layout=this._layout),rt(e,this.item.width,this.item.height)}async _loadPreview(){if(!this.item||!this.entryId||!this.hass.callWS)return;let e=++this._requestId;this._previewLoading=!0,this._previewError=null;try{let t=await this.hass.callWS(pr(this.entryId,this.item.source,this.item.id,this._buildOptions()));if(e!==this._requestId)return;this._preview=t}catch(t){if(e!==this._requestId)return;this._previewError=M(t),this._preview=null}finally{e===this._requestId&&(this._previewLoading=!1)}}_selectLayout(e){this._layout=e,this._loadPreview()}_updateAdjust(e){this._adjust={...this._adjust,...e},this._debounceTimer!==void 0&&clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>void this._loadPreview(),Ss)}_clearBackground(){let{background:e,...t}=this._adjust;this._adjust=t,this._loadPreview()}async _saveToLibrary(){if(!(!this.item||!this.entryId||!this.hass.callWS)){this._saving="save",this._actionError=null;try{await this.hass.callWS(Ht(this.entryId,this.item.source,this.item.id,this._buildOptions())),this.dispatchEvent(new CustomEvent("iledclock-designs-changed",{bubbles:!0,composed:!0})),this._close()}catch(e){this._actionError=M(e)}finally{this._saving=null}}}_close(){this.dispatchEvent(new CustomEvent("close-requested",{bubbles:!0,composed:!0}))}_onKeydown(e){e.key==="Escape"&&this._close()}render(){if(!this.open||!this.item)return c;let e=this.item,t=[];for(let s of["auto",...this._preview?.layouts_available??[]])t.includes(s)||t.push(s);return l`
      <div class="backdrop" @click=${this._close}></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label=${e.title} @keydown=${this._onKeydown}>
        <header>
          <h2>${e.title}</h2>
          <button type="button" class="icon-button" @click=${this._close} aria-label="Close">${m("close")}</button>
        </header>
        <div class="body">
          ${this._actionError?l`<p class="error">${this._actionError}</p>`:c}
          <div class="preview-plate">
            ${this._pixelFrames.length===0&&this._previewLoading?l`<div class="skeleton"></div>`:l`<iledclock-matrix-canvas .frame=${this._currentFrame()} bloom></iledclock-matrix-canvas>`}
          </div>
          ${this._previewError?l`<p class="error">${this._previewError}</p>`:c}
          <iledclock-segmented-picker
            group-label="Layout"
            content-fit
            .options=${t.map(s=>({value:s,label:it(s)}))}
            .value=${this._layout}
            @option-selected=${s=>this._selectLayout(s.detail.value)}
          ></iledclock-segmented-picker>
          ${this._layout==="auto"&&this._preview&&ie(this._preview.report.notes)?l`<p class="hint">${ie(this._preview.report.notes)}</p>`:c}
          <button type="button" class="disclosure" @click=${()=>this._adjustOpen=!this._adjustOpen}>
            ${m(this._adjustOpen?"chevronUp":"chevronDown")} Adjust
          </button>
          ${this._adjustOpen?this._renderAdjust(e):c}
          ${this._renderCredit(e)}
        </div>
        <div class="actions">
          <button type="button" class="secondary-action" ?disabled=${this._saving!==null} @click=${this._saveToLibrary}>
            ${m("save")} ${this._saving==="save"?"Saving\u2026":"Save to library"}
          </button>
          <iledclock-hold-button label="Hold to show on clock" complete-label="Showing" ?disabled=${this._saving!==null} @confirmed=${this._showOnClock}></iledclock-hold-button>
        </div>
      </div>
    `}_renderCredit(e){let t=dr(e,this.source),s=e.author?`By ${e.author} on ${this.source?.name??e.source}.`:`From ${this.source?.name??e.source}.`;return l`<p class="credit">${s} ${t?l`<a href=${t} target="_blank" rel="noopener noreferrer">View original</a>`:c}</p>`}_renderAdjust(e){let t=this._adjust.crop??{x:0,y:0,w:e.width,h:e.height},s=this._adjust.scale??1,n=this._adjust.offset??{x:0,y:0},o=this._adjust.enhance??!1;return l`
      <div class="adjust">
        <span class="adjust-label">Crop (source pixels)</span>
        <div class="crop-grid">
          <label class="stepper-field">X<iledclock-stepper .value=${t.x} min="0" .max=${e.width} step="1" @value-selected=${a=>this._updateAdjust({crop:{...t,x:a.detail.value}})}></iledclock-stepper></label>
          <label class="stepper-field">Y<iledclock-stepper .value=${t.y} min="0" .max=${e.height} step="1" @value-selected=${a=>this._updateAdjust({crop:{...t,y:a.detail.value}})}></iledclock-stepper></label>
          <label class="stepper-field">Width<iledclock-stepper .value=${t.w} min="1" .max=${e.width} step="1" @value-selected=${a=>this._updateAdjust({crop:{...t,w:a.detail.value}})}></iledclock-stepper></label>
          <label class="stepper-field">Height<iledclock-stepper .value=${t.h} min="1" .max=${e.height} step="1" @value-selected=${a=>this._updateAdjust({crop:{...t,h:a.detail.value}})}></iledclock-stepper></label>
        </div>
        <label class="stepper-field">Scale<iledclock-stepper .value=${s} min="1" max="16" step="1" @value-selected=${a=>this._updateAdjust({scale:a.detail.value})}></iledclock-stepper></label>
        <div class="two-up">
          <label class="stepper-field">Offset X<iledclock-stepper .value=${n.x} min=${-nt} max=${nt} step="1" @value-selected=${a=>this._updateAdjust({offset:{...n,x:a.detail.value}})}></iledclock-stepper></label>
          <label class="stepper-field">Offset Y<iledclock-stepper .value=${n.y} min=${-nt} max=${nt} step="1" @value-selected=${a=>this._updateAdjust({offset:{...n,y:a.detail.value}})}></iledclock-stepper></label>
        </div>
        <div class="background-row">
          <span class="adjust-label">Background</span>
          <input type="color" .value=${O(this._adjust.background??[0,0,0])} @input=${a=>this._updateAdjust({background:F(a.target.value)})} />
          ${this._adjust.background?l`<button type="button" class="link-button" @click=${this._clearBackground}>Clear</button>`:c}
        </div>
        <button type="button" class="toggle-row" @click=${()=>this._updateAdjust({enhance:!o})}>
          <span class="toggle-label">Enhance colours</span>
          <span class="toggle-pill ${o?"on":""}"><span class="toggle-knob"></span></span>
        </button>
      </div>
    `}};Me.properties={hass:{attribute:!1},entryId:{attribute:!1},open:{type:Boolean,reflect:!0},item:{attribute:!1},source:{attribute:!1},_layout:{state:!0},_adjustOpen:{state:!0},_adjust:{state:!0},_preview:{state:!0},_previewLoading:{state:!0},_previewError:{state:!0},_saving:{state:!0},_actionError:{state:!0}},Me.styles=[y,_`
    :host(:not([open])) {
      display: none;
    }
    :host {
      position: fixed;
      inset: 0;
      z-index: 110;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: var(--lu-scrim, rgba(0, 0, 0, 0.5));
    }
    .panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: min(480px, 100vw);
      background: var(--lu-card);
      color: var(--lu-ink);
      box-shadow: var(--lu-shadow-raised);
      border-left: 1px solid var(--lu-edge);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      container-type: inline-size;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--lu-edge);
      position: sticky;
      top: 0;
      background: inherit;
      z-index: 1;
    }
    h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .icon-button {
      flex: none;
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-button:hover {
      background: var(--lu-tile);
    }
    .body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .preview-plate {
      aspect-ratio: 2 / 1;
      width: 100%;
      border-radius: var(--lu-radius-tile);
      overflow: hidden;
      background: #050607;
      border: 1px solid var(--lu-edge);
    }
    .skeleton {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #0a0b0c 25%, #16181a 37%, #0a0b0c 63%);
      background-size: 400% 100%;
      animation: shimmer 1.4s ease infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .skeleton {
        animation: none;
        background: #0f1112;
      }
    }
    @keyframes shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: 0 0; }
    }
    .disclosure {
      display: flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
      min-height: var(--lu-target, 48px);
      padding: 0 14px;
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .adjust {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      border-radius: var(--lu-radius-tile);
      background: var(--lu-tile);
    }
    .adjust-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--lu-ink-2);
    }
    .crop-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    @container (min-width: 360px) {
      .crop-grid,
      .two-up {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .two-up {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .stepper-field {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--lu-ink-2);
    }
    .background-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .background-row input[type="color"] {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      overflow: hidden;
      padding: 0;
      background: none;
      cursor: pointer;
    }
    .link-button {
      background: none;
      border: none;
      color: var(--lu-accent);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      padding: 6px 0;
      min-height: var(--lu-target, 48px);
      color: var(--lu-ink);
      cursor: pointer;
      text-align: left;
      font-size: 14px;
    }
    .toggle-label {
      flex: 1;
    }
    .toggle-pill {
      flex: none;
      width: 40px;
      height: 24px;
      border-radius: var(--lu-radius-pill);
      background: var(--lu-track-off);
      position: relative;
    }
    .toggle-pill.on {
      background: var(--lu-accent);
    }
    .toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform var(--lu-motion-focus) var(--lu-ease);
    }
    .toggle-pill.on .toggle-knob {
      transform: translateX(16px);
    }
    .credit {
      margin: 0;
      font-size: 13px;
      color: var(--lu-ink-2);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .credit a {
      color: var(--lu-accent);
      font-weight: 600;
      text-decoration: none;
    }
    .credit a:hover {
      text-decoration: underline;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 16px 20px;
      border-top: 1px solid var(--lu-edge);
      position: sticky;
      bottom: 0;
      background: inherit;
    }
    .secondary-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }
    .secondary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
    }
    `];customElements.define("iledclock-gallery-item-sheet",Me);var Cs=200,Es=100,Ls=300,Ms=6,As="iledclock";function Is(){return{source:"",sort:"",query:"",size:void 0,animatedOnly:!1}}function Ts(r){return r.id==="divoom"?"Add a free Divoom account to browse 700k+ designs.":`Add a free ${r.name} account to browse its gallery.`}var Ae=class extends g{constructor(){super();this._signedCache=new tt;this._tileSchedules=new Map;this._tileObserver=null;this._tileTickInterval=null;this._sentinelObserver=null;this._sentinelRef=X();this._sources=[],this._sourcesLoading=!1,this._sourcesError=null,this._browse=st(Is()),this._signedPaths={},this._selectedItem=null,this._itemSheetOpen=!1}connectedCallback(){super.connectedCallback(),this._sentinelObserver=new IntersectionObserver(e=>{e.some(t=>t.isIntersecting)&&this._loadMore()},{rootMargin:"400px"})}disconnectedCallback(){super.disconnectedCallback(),this._tileObserver?.disconnect(),this._sentinelObserver?.disconnect(),this._tileTickInterval!==null&&clearInterval(this._tileTickInterval),clearTimeout(this._searchDebounce)}willUpdate(e){!e.has("hass")&&!e.has("entryId")||!this.hass||!this.entryId||this.entryId!==this._lastEntryId&&(this._lastEntryId=this.entryId,this._loadSources())}updated(){let e=this._browse.hasMore&&!this._browse.error?this._sentinelRef.value:void 0;e!==this._lastObservedSentinel&&(this._sentinelObserver?.disconnect(),e&&this._sentinelObserver?.observe(e),this._lastObservedSentinel=e)}async _loadSources(){if(!(!this.entryId||!this.hass.callWS)){this._sourcesLoading=!0,this._sourcesError=null;try{this._sources=await this.hass.callWS(cr(this.entryId));let e=this._sources.filter(s=>s.configured),t=e.some(s=>s.id===this._browse.filters.source);e.length>0&&!t&&(this._resetGrid({source:e[0].id,sort:e[0].default_sort,query:"",size:void 0,animatedOnly:!1}),this._loadMore())}catch(e){this._sourcesError=M(e)}finally{this._sourcesLoading=!1}}}_resetGrid(e){this._browse=st(e),this._tileObserver?.disconnect(),this._tileObserver=null,this._tileSchedules.clear()}_applyFilters(e){let t=fr(this._browse,e);t!==this._browse&&(this._resetGrid(t.filters),this._loadMore())}async _loadMore(){let e=_r(this._browse);if(e===this._browse)return;this._browse=e;let t=this._activeSource(),s=e.filters,n=e.page;if(!this.entryId||!this.hass.callWS){this._browse=zt(this._browse,s,n,"Not connected to Home Assistant.");return}try{let o=await this.hass.callWS(ur(this.entryId,{source:s.source,sort:s.sort,page:n,query:t?.supports_search?s.query:void 0,size:s.size,animatedOnly:s.animatedOnly}));this._browse=br(this._browse,s,n,o),this._signItems(o.items)}catch(o){this._browse=zt(this._browse,s,n,M(o))}}async _signItems(e){let t=e.filter(n=>!this._signedPaths[K(n)]);if(t.length===0)return;let s=await Promise.all(t.map(async n=>[K(n),await this._signedCache.sign(this.hass,n.media_path)]));this._signedPaths={...this._signedPaths,...Object.fromEntries(s)}}_activeSource(){return this._sources.find(e=>e.id===this._browse.filters.source)}_configuredSources(){return this._sources.filter(e=>e.configured)}_accountPromptSources(){return this._sources.filter(e=>!e.configured&&e.requires_account)}_visibleItems(){return this._activeSource()?.supports_search?this._browse.items:vr(this._browse.items,this._browse.filters.query)}_onSearchInput(e){if(this._activeSource()?.supports_search){clearTimeout(this._searchDebounce),this._searchDebounce=setTimeout(()=>this._applyFilters({query:e}),Ls);return}this._browse={...this._browse,filters:{...this._browse.filters,query:e}}}_onSourceSelected(e){let t=this._sources.find(s=>s.id===e);this._applyFilters({source:e,sort:t?.default_sort??"",query:"",size:void 0})}_onSortSelected(e){this._applyFilters({sort:e})}_onSizeSelected(e){this._applyFilters({size:e.length>0?e:void 0})}_toggleAnimatedOnly(){this._applyFilters({animatedOnly:!this._browse.filters.animatedOnly})}_openIntegrationOptions(){history.pushState(null,"",`/config/integrations/integration/${As}`),window.dispatchEvent(new CustomEvent("location-changed",{bubbles:!0,composed:!0}))}_openItem(e){this._selectedItem=e,this._itemSheetOpen=!0}_onItemSheetClosed(){this._itemSheetOpen=!1}_ensureTileObserver(){return this._tileObserver||(this._tileObserver=new IntersectionObserver(e=>{let t=performance.now(),s=!1;for(let n of e){let o=n.target.dataset.tileKey;if(!o)continue;let a=this._tileSchedules.get(o)??Nt,d=xr(a,n.isIntersecting,t);d!==a&&(this._tileSchedules.set(o,d),s=!0)}s&&(this._ensureTileTicking(),this.requestUpdate())},{rootMargin:"150px",threshold:.1})),this._tileObserver}_ensureTileTicking(){this._tileTickInterval===null&&(this._tileTickInterval=setInterval(()=>{let e=performance.now(),t=!1,s=!1;for(let[n,o]of this._tileSchedules){if(o.pending===null)continue;t=!0;let a=wr(o,e,Cs);a!==o&&(this._tileSchedules.set(n,a),s=!0)}s&&this.requestUpdate(),!t&&this._tileTickInterval!==null&&(clearInterval(this._tileTickInterval),this._tileTickInterval=null)},Es))}_observeTile(e,t){!t.animated||!e||(e.dataset.tileKey=K(t),this._ensureTileObserver().observe(e))}render(){let e=this._activeSource(),t=this._configuredSources(),s=this._accountPromptSources();return l`
      <div class="toolbar">
        <input
          class="search-input"
          type="search"
          placeholder="Search designs"
          .value=${this._browse.filters.query}
          ?disabled=${!e}
          @input=${n=>this._onSearchInput(n.target.value)}
        />
        ${this._sourcesLoading?l`<p class="hint">Loading gallery sources…</p>`:c}
        ${this._sourcesError?l`<p class="error">${this._sourcesError}</p>`:c}
        ${t.length>0?l`
              <iledclock-segmented-picker
                group-label="Source"
                content-fit
                .options=${t.map(n=>({value:n.id,label:n.name}))}
                .value=${this._browse.filters.source}
                @option-selected=${n=>this._onSourceSelected(n.detail.value)}
              ></iledclock-segmented-picker>
            `:c}
        ${s.map(n=>l`
            <button type="button" class="account-row" @click=${this._openIntegrationOptions}>
              <span>${Ts(n)}</span>
              ${m("chevronRight")}
            </button>
          `)}
        ${e?this._renderSortAndFilters(e):c}
      </div>
      ${!this._sourcesLoading&&!e&&t.length===0&&s.length===0?l`<p class="empty-state">No gallery sources are available right now.</p>`:c}
      ${e?this._renderGrid():c}
      <iledclock-gallery-item-sheet
        .hass=${this.hass}
        .entryId=${this.entryId}
        .item=${this._selectedItem}
        .source=${e}
        ?open=${this._itemSheetOpen}
        @close-requested=${this._onItemSheetClosed}
      ></iledclock-gallery-item-sheet>
    `}_renderSortAndFilters(e){return l`
      <iledclock-segmented-picker
        group-label="Sort"
        content-fit
        .options=${e.sorts.map(t=>({value:t.id,label:t.label}))}
        .value=${this._browse.filters.sort}
        @option-selected=${t=>this._onSortSelected(t.detail.value)}
      ></iledclock-segmented-picker>
      <div class="filter-row">
        <button type="button" class="filter-chip ${this._browse.filters.animatedOnly?"on":""}" @click=${()=>this._toggleAnimatedOnly()}>
          ${m("gif")} Animated only
        </button>
        ${e.sizes.length>1?l`
              <iledclock-segmented-picker
                group-label="Size"
                content-fit
                .options=${[{value:"",label:"All sizes"},...e.sizes.map(t=>({value:t,label:t}))]}
                .value=${this._browse.filters.size??""}
                @option-selected=${t=>this._onSizeSelected(t.detail.value)}
              ></iledclock-segmented-picker>
            `:c}
      </div>
    `}_renderGrid(){let e=this._visibleItems();return l`
      <div class="grid">
        ${e.map(t=>this._renderTile(t))}
        ${this._browse.loading?Array.from({length:Ms},()=>l`<div class="tile"><div class="plate"><div class="skeleton"></div></div></div>`):c}
      </div>
      ${!this._browse.loading&&e.length===0&&!this._browse.error?l`<p class="empty-state">No designs match your search.</p>`:c}
      ${this._browse.error?l`
            <div class="error-row">
              <p class="error">${this._browse.error}</p>
              <button type="button" class="retry-button" @click=${()=>void this._loadMore()}>Retry</button>
            </div>
          `:c}
      ${this._browse.hasMore&&!this._browse.error?l`<div class="sentinel" ${I(this._sentinelRef)}></div>`:c}
    `}_renderTile(e){let t=K(e),s=this._tileSchedules.get(t)??Nt,n=We(),o=this._signedPaths[t],a=!!o&&(!e.animated||$r(s,e.animated,n)),d=yr(e);return l`
      <button type="button" class="tile" @click=${()=>this._openItem(e)} aria-label=${e.title}>
        <div class="plate" ${I(p=>this._observeTile(p,e))}>
          ${a?l`<img class="art" src=${o} alt="" loading="lazy" decoding="async" />`:l`<div class="skeleton ${o?"static":""}"></div>`}
          ${e.animated&&!a&&o?l`<span class="badge" title="Animated design">${m("gif")}</span>`:c}
        </div>
        <p class="title">${e.title}</p>
        ${d?l`<p class="meta">${d}</p>`:c}
      </button>
    `}};Ae.properties={hass:{attribute:!1},entryId:{attribute:!1},_sources:{state:!0},_sourcesLoading:{state:!0},_sourcesError:{state:!0},_browse:{state:!0},_signedPaths:{state:!0},_selectedItem:{state:!0},_itemSheetOpen:{state:!0}},Ae.styles=[y,_`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 16px;
      container-type: inline-size;
      color: var(--lu-ink);
    }
    .toolbar {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 16px;
    }
    .search-input {
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 16px;
      font-size: 15px;
      box-sizing: border-box;
    }
    .search-input:disabled {
      opacity: 0.5;
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .account-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px dashed var(--lu-edge);
      background: none;
      color: var(--lu-ink-2);
      padding: 0 14px;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
    }
    .filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      padding: 0 16px;
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .filter-chip.on {
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      border-color: transparent;
    }
    iledclock-segmented-picker {
      max-width: 100%;
    }
    .empty-state {
      margin: 24px 0;
      text-align: center;
      font-size: 14px;
      color: var(--lu-ink-2);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    @container (min-width: 480px) {
      .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @container (min-width: 700px) {
      .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    @container (min-width: 960px) {
      .grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      text-align: left;
      color: inherit;
      font: inherit;
    }
    .plate {
      position: relative;
      width: 100%;
      min-height: 0;
      aspect-ratio: 1 / 1;
      border-radius: var(--lu-radius-tile);
      overflow: hidden;
      background: #050607;
      border: 1px solid var(--lu-edge);
    }
    .art {
      /* Absolutely placed so the image's own size can never stretch the square plate (a 32x8
         strip made its tile taller than its neighbours). */
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      image-rendering: pixelated;
    }
    .skeleton {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #0a0b0c 25%, #16181a 37%, #0a0b0c 63%);
      background-size: 400% 100%;
      animation: gallery-shimmer 1.4s ease infinite;
    }
    .skeleton.static {
      animation: none;
      background: #0a0b0c;
    }
    @keyframes gallery-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: 0 0; }
    }
    .badge {
      position: absolute;
      right: 6px;
      bottom: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
    }
    .title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--lu-ink);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      margin: 0;
      font-size: 12px;
      color: var(--lu-ink-2);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .error-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin: 16px 0;
    }
    .retry-button {
      min-height: var(--lu-target, 48px);
      padding: 0 16px;
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .sentinel {
      height: 1px;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
        animation: none !important;
      }
    }
    `];customElements.define("iledclock-gallery-browser",Ae);var Ps=250,ot=64,Ie=class extends g{constructor(){super();this._filename="";this._dataB64="";this._fileSizeBytes=0;this._pixelFrames=[];this._playStartedAt=0;this._rafId=null;this._requestId=0;this._sourceImgRef=X();this._dragMode=null;this._dragStartClientX=0;this._dragStartClientY=0;this._dragStartBox=null;this._dragRenderedWidth=0;this._dragRenderedHeight=0;this._onFileInputChange=async e=>{let t=e.target,s=t.files?.[0];t.value="",s&&await this._acceptFile(s)};this._onDrop=async e=>{e.preventDefault();let t=e.dataTransfer?.files?.[0];t&&await this._acceptFile(t)};this._onDragOver=e=>{e.preventDefault()};this._fetchUrl=async()=>{let e=this._urlInput.trim();if(e){this._fetchingUrl=!0,this._pickError=null;try{let t=await fetch(e);if(!t.ok)throw new Error(`Server responded ${t.status}`);let s=await t.blob(),n=mr(e,s.type),o=Ft(n,s.size);if(o){this._pickError=o;return}let a=await this._readAsDataUrl(s),d=a.slice(a.indexOf(",")+1);this._beginPreviewStage(n,d,s.size,Ot(n)?a:null)}catch{this._pickError="Couldn't load that image directly (many sites block this). Try saving it to your device and picking the file instead."}finally{this._fetchingUrl=!1}}};this._onSourceImageLoad=()=>{let e=this._sourceImgRef.value;e&&(this._naturalWidth=e.naturalWidth,this._naturalHeight=e.naturalHeight,this._cropBox=Pt(e.naturalWidth,e.naturalHeight))};this._clearBackground=()=>{let{background:e,...t}=this._adjust;this._adjust=t,this._loadPreview()};this._resetCrop=()=>{this._cropTouched=!1,this._naturalWidth>0&&(this._cropBox=Pt(this._naturalWidth,this._naturalHeight)),this._loadPreview()};this._onDragMove=e=>{if(!this._dragMode||!this._dragStartBox)return;let{dx:t,dy:s}=tr(e.clientX-this._dragStartClientX,e.clientY-this._dragStartClientY,this._dragRenderedWidth,this._dragRenderedHeight,this._naturalWidth,this._naturalHeight);this._cropBox=this._dragMode==="move"?ir(this._dragStartBox,t,s,this._naturalWidth,this._naturalHeight):rr(this._dragStartBox,this._dragMode,t,s,this._naturalWidth,this._naturalHeight),this._cropTouched=!0};this._onDragEnd=()=>{this._dragMode&&(this._teardownDrag(),this._loadPreview())};this._save=()=>this._finishImport(!1);this._show=()=>this._finishImport(!0);this.open=!1,this._stage="pick",this._sourceDataUrl=null,this._naturalWidth=0,this._naturalHeight=0,this._cropBox=null,this._cropTouched=!1,this._urlInput="",this._fetchingUrl=!1,this._pickError=null,this._layout="auto",this._adjustOpen=!1,this._adjust={},this._preview=null,this._previewLoading=!1,this._previewError=null,this._saving=null,this._actionError=null}disconnectedCallback(){super.disconnectedCallback(),this._stopLoop(),clearTimeout(this._debounceTimer),this._teardownDrag()}updated(e){e.has("open")&&this.open&&this._resetState(),e.has("_preview")&&(this._pixelFrames=this._preview?this._preview.frames.map((t,s)=>xe(t,32,16,this._preview.delays_ms[s]??100)):[],this._playStartedAt=performance.now())}_resetState(){this._stage="pick",this._filename="",this._dataB64="",this._fileSizeBytes=0,this._sourceDataUrl=null,this._naturalWidth=0,this._naturalHeight=0,this._cropBox=null,this._cropTouched=!1,this._urlInput="",this._fetchingUrl=!1,this._pickError=null,this._layout="auto",this._adjustOpen=!1,this._adjust={},this._preview=null,this._previewError=null,this._actionError=null,this._pixelFrames=[],this._stopLoop()}_startLoop(){if(this._rafId!==null)return;this._playStartedAt=performance.now();let e=()=>{this.requestUpdate(),this._rafId=requestAnimationFrame(e)};this._rafId=requestAnimationFrame(e)}_stopLoop(){this._rafId!==null&&cancelAnimationFrame(this._rafId),this._rafId=null}_currentFrame(){return this._pixelFrames.length===0?null:this._pixelFrames[N(this._pixelFrames,performance.now()-this._playStartedAt)]}async _acceptFile(e){let t=Ft(e.name,e.size);if(t){this._pickError=t;return}let s=await this._readAsDataUrl(e),n=s.slice(s.indexOf(",")+1);this._beginPreviewStage(e.name,n,e.size,Ot(e.name)?s:null)}_readAsDataUrl(e){return new Promise((t,s)=>{let n=new FileReader;n.onload=()=>t(String(n.result)),n.onerror=()=>s(n.error),n.readAsDataURL(e)})}_beginPreviewStage(e,t,s,n){this._filename=e,this._dataB64=t,this._fileSizeBytes=s,this._sourceDataUrl=n,this._naturalWidth=0,this._naturalHeight=0,this._cropBox=null,this._cropTouched=!1,this._layout="auto",this._adjust={},this._adjustOpen=!1,this._pickError=null,this._stage="preview",this._loadPreview(),this._startLoop()}_backToPick(){this._resetState()}_sourceDimensions(){return this._naturalWidth>0&&this._naturalHeight>0?{width:this._naturalWidth,height:this._naturalHeight}:this._preview?{width:this._preview.report.native_size[0],height:this._preview.report.native_size[1]}:{width:32,height:16}}_buildOptions(){let e={...this._adjust};this._layout!=="auto"&&(e.layout=this._layout),this._sourceDataUrl&&this._cropTouched&&this._cropBox&&(e.crop=this._cropBox);let t=this._sourceDimensions();return rt(e,t.width,t.height)}async _loadPreview(){if(!this.entryId||!this.hass.callWS||!this._filename)return;let e=++this._requestId;this._previewLoading=!0,this._previewError=null;try{let t=await this.hass.callWS(Rt(this.entryId,{filename:this._filename,dataB64:this._dataB64,options:this._buildOptions(),save:!1}));if(e!==this._requestId)return;this._preview=t}catch(t){if(e!==this._requestId)return;this._previewError=M(t),this._preview=null}finally{e===this._requestId&&(this._previewLoading=!1)}}_selectLayout(e){this._layout=e,this._loadPreview()}_updateAdjust(e){this._adjust={...this._adjust,...e},clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>void this._loadPreview(),Ps)}_startDrag(e,t){if(!this._cropBox)return;e.preventDefault(),e.stopPropagation();let s=this._sourceImgRef.value;if(!s)return;let n=s.getBoundingClientRect();this._dragMode=t,this._dragStartClientX=e.clientX,this._dragStartClientY=e.clientY,this._dragStartBox=this._cropBox,this._dragRenderedWidth=n.width,this._dragRenderedHeight=n.height,window.addEventListener("pointermove",this._onDragMove),window.addEventListener("pointerup",this._onDragEnd),window.addEventListener("pointercancel",this._onDragEnd)}_teardownDrag(){this._dragMode=null,this._dragStartBox=null,window.removeEventListener("pointermove",this._onDragMove),window.removeEventListener("pointerup",this._onDragEnd),window.removeEventListener("pointercancel",this._onDragEnd)}async _finishImport(e){if(!(!this.entryId||!this.hass.callWS)){this._saving=e?"show":"save",this._actionError=null;try{let t=await this.hass.callWS(Rt(this.entryId,{filename:this._filename,dataB64:this._dataB64,options:this._buildOptions(),save:!0}));if(!lr(t))throw new Error("Save didn't return a design id.");e&&await this.hass.callWS(H(this.entryId,{design_id:t.design_id})),this.dispatchEvent(new CustomEvent("iledclock-designs-changed",{bubbles:!0,composed:!0})),this.dispatchEvent(new CustomEvent("iledclock-open-design",{detail:{design_id:t.design_id},bubbles:!0,composed:!0})),this._close()}catch(t){this._actionError=M(t)}finally{this._saving=null}}}_close(){this.dispatchEvent(new CustomEvent("close-requested",{bubbles:!0,composed:!0}))}_onKeydown(e){e.key==="Escape"&&this._close()}render(){return this.open?l`
      <div class="backdrop" @click=${this._close}></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Import" @keydown=${e=>this._onKeydown(e)}>
        <header>
          <h2>Import</h2>
          <button type="button" class="icon-button" @click=${this._close} aria-label="Close">${m("close")}</button>
        </header>
        <div class="body">${this._stage==="pick"?this._renderPick():this._renderPreviewStage()}</div>
      </div>
    `:c}_renderPick(){return l`
      <div class="drop-zone" @dragover=${this._onDragOver} @drop=${this._onDrop}>
        <span class="drop-icon">${m("upload")}</span>
        <p>Drop a GIF, PNG, JPEG, WebP, .aseprite or .piskel file</p>
        <label class="pick-button">
          Choose a file
          <input type="file" accept=".gif,.png,.jpg,.jpeg,.webp,.aseprite,.ase,.piskel" hidden @change=${this._onFileInputChange} />
        </label>
      </div>
      <div class="url-row">
        <input
          class="url-input"
          type="text"
          placeholder="Or paste an image URL"
          .value=${this._urlInput}
          @input=${e=>this._urlInput=e.target.value}
        />
        <button type="button" class="secondary-action" ?disabled=${this._fetchingUrl||!this._urlInput.trim()} @click=${this._fetchUrl}>
          ${this._fetchingUrl?"Fetching\u2026":"Fetch"}
        </button>
      </div>
      ${this._pickError?l`<p class="error">${this._pickError}</p>`:c}
    `}_renderPreviewStage(){let e=this._sourceDimensions();return l`
      ${this._actionError?l`<p class="error">${this._actionError}</p>`:c}
      ${this._sourceDataUrl?l`
            <div class="crop-stage">
              <img class="source-img" ${I(this._sourceImgRef)} src=${this._sourceDataUrl} @load=${this._onSourceImageLoad} alt="" />
              ${this._cropBox?this._renderCropOverlay(this._cropBox):c}
            </div>
            <div class="crop-controls">
              <p class="hint">Drag the box to crop, or drag a handle to resize.</p>
              ${this._cropTouched?l`<button type="button" class="link-button" @click=${this._resetCrop}>Reset crop</button>`:c}
            </div>
          `:l`<p class="hint">${this._filename} can't be shown directly here (only the server can decode it) -- showing the adapted preview below.</p>`}
      <div class="preview-plate">
        ${this._pixelFrames.length===0&&this._previewLoading?l`<div class="skeleton"></div>`:l`<iledclock-matrix-canvas .frame=${this._currentFrame()} bloom></iledclock-matrix-canvas>`}
      </div>
      ${this._previewError?l`<p class="error">${this._previewError}</p>`:c}
      <iledclock-segmented-picker
        group-label="Layout"
        content-fit
        .options=${ar(this._preview?.layouts_available??[]).map(t=>({value:t,label:it(t)}))}
        .value=${this._layout}
        @option-selected=${t=>this._selectLayout(t.detail.value)}
      ></iledclock-segmented-picker>
      ${this._layout==="auto"&&this._preview&&ie(this._preview.report.notes)?l`<p class="hint">${ie(this._preview.report.notes)}</p>`:c}
      <button type="button" class="disclosure" @click=${()=>this._adjustOpen=!this._adjustOpen}>${m(this._adjustOpen?"chevronUp":"chevronDown")} Adjust</button>
      ${this._adjustOpen?this._renderAdjust(e):c}
      <button type="button" class="link-row" @click=${()=>this._backToPick()}>${m("chevronLeft")} Choose a different file</button>
      <div class="actions">
        <button type="button" class="secondary-action" ?disabled=${this._saving!==null} @click=${this._save}>${m("save")} ${this._saving==="save"?"Saving\u2026":"Save"}</button>
        <iledclock-hold-button label="Hold to show on clock" complete-label="Showing" ?disabled=${this._saving!==null} @confirmed=${this._show}></iledclock-hold-button>
      </div>
    `}_renderCropOverlay(e){let t=this._naturalWidth||1,s=this._naturalHeight||1,n=`left:${e.x/t*100}%; top:${e.y/s*100}%; width:${e.w/t*100}%; height:${e.h/s*100}%;`;return l`
      <div class="crop-box" style=${n} @pointerdown=${o=>this._startDrag(o,"move")}>
        ${er.map(o=>l`<span class="handle handle-${o}" @pointerdown=${a=>this._startDrag(a,o)}></span>`)}
      </div>
    `}_renderAdjust(e){let t=this._adjust.scale??1,s=this._adjust.offset??{x:0,y:0},n=this._adjust.enhance??!1;return l`
      <div class="adjust">
        ${this._sourceDataUrl?c:this._renderNumericCrop(e)}
        <label class="stepper-field">
          Scale<iledclock-stepper .value=${t} min="1" max="16" step="1" @value-selected=${o=>this._updateAdjust({scale:o.detail.value})}></iledclock-stepper>
        </label>
        <div class="two-up">
          <label class="stepper-field">
            Offset X<iledclock-stepper
              .value=${s.x}
              min=${-ot}
              max=${ot}
              step="1"
              @value-selected=${o=>this._updateAdjust({offset:{...s,x:o.detail.value}})}
            ></iledclock-stepper>
          </label>
          <label class="stepper-field">
            Offset Y<iledclock-stepper
              .value=${s.y}
              min=${-ot}
              max=${ot}
              step="1"
              @value-selected=${o=>this._updateAdjust({offset:{...s,y:o.detail.value}})}
            ></iledclock-stepper>
          </label>
        </div>
        <div class="background-row">
          <span class="adjust-label">Background</span>
          <input
            type="color"
            .value=${O(this._adjust.background??[0,0,0])}
            @input=${o=>this._updateAdjust({background:F(o.target.value)})}
          />
          ${this._adjust.background?l`<button type="button" class="link-button" @click=${this._clearBackground}>Clear</button>`:c}
        </div>
        <button type="button" class="toggle-row" @click=${()=>this._updateAdjust({enhance:!n})}>
          <span class="toggle-label">Enhance colours</span>
          <span class="toggle-pill ${n?"on":""}"><span class="toggle-knob"></span></span>
        </button>
      </div>
    `}_renderNumericCrop(e){let t=this._adjust.crop??{x:0,y:0,w:e.width,h:e.height};return l`
      <span class="adjust-label">Crop (source pixels)</span>
      <div class="crop-grid">
        <label class="stepper-field">
          X<iledclock-stepper .value=${t.x} min="0" .max=${e.width} step="1" @value-selected=${s=>this._updateAdjust({crop:{...t,x:s.detail.value}})}></iledclock-stepper>
        </label>
        <label class="stepper-field">
          Y<iledclock-stepper .value=${t.y} min="0" .max=${e.height} step="1" @value-selected=${s=>this._updateAdjust({crop:{...t,y:s.detail.value}})}></iledclock-stepper>
        </label>
        <label class="stepper-field">
          Width<iledclock-stepper .value=${t.w} min="1" .max=${e.width} step="1" @value-selected=${s=>this._updateAdjust({crop:{...t,w:s.detail.value}})}></iledclock-stepper>
        </label>
        <label class="stepper-field">
          Height<iledclock-stepper .value=${t.h} min="1" .max=${e.height} step="1" @value-selected=${s=>this._updateAdjust({crop:{...t,h:s.detail.value}})}></iledclock-stepper>
        </label>
      </div>
    `}};Ie.properties={hass:{attribute:!1},entryId:{attribute:!1},open:{type:Boolean,reflect:!0},_stage:{state:!0},_sourceDataUrl:{state:!0},_naturalWidth:{state:!0},_naturalHeight:{state:!0},_cropBox:{state:!0},_cropTouched:{state:!0},_urlInput:{state:!0},_fetchingUrl:{state:!0},_pickError:{state:!0},_layout:{state:!0},_adjustOpen:{state:!0},_adjust:{state:!0},_preview:{state:!0},_previewLoading:{state:!0},_previewError:{state:!0},_saving:{state:!0},_actionError:{state:!0}},Ie.styles=[y,_`
    :host(:not([open])) {
      display: none;
    }
    :host {
      position: fixed;
      inset: 0;
      z-index: 110;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: var(--lu-scrim, rgba(0, 0, 0, 0.5));
    }
    .panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: min(480px, 100vw);
      background: var(--lu-card);
      color: var(--lu-ink);
      box-shadow: var(--lu-shadow-raised);
      border-left: 1px solid var(--lu-edge);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      container-type: inline-size;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--lu-edge);
      position: sticky;
      top: 0;
      background: inherit;
      z-index: 1;
    }
    h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
    }
    .icon-button {
      flex: none;
      width: var(--lu-target, 48px);
      height: var(--lu-target, 48px);
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--lu-ink);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .icon-button:hover {
      background: var(--lu-tile);
    }
    .body {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .error {
      margin: 0;
      font-size: 13px;
      color: var(--lu-danger);
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--lu-ink-2);
    }
    .drop-zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 32px 16px;
      border-radius: var(--lu-radius-tile);
      border: 2px dashed var(--lu-edge);
      text-align: center;
    }
    .drop-zone p {
      margin: 0;
      font-size: 14px;
      color: var(--lu-ink-2);
    }
    .drop-icon {
      display: inline-flex;
      color: var(--lu-ink-2);
      font-size: 28px;
    }
    .pick-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: var(--lu-target, 48px);
      padding: 0 20px;
      border-radius: var(--lu-radius-pill);
      background: var(--lu-accent);
      color: var(--lu-accent-ink);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .url-row {
      display: flex;
      gap: 8px;
    }
    .url-input {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--lu-edge);
      background: var(--lu-card);
      color: var(--lu-ink);
      padding: 0 12px;
      box-sizing: border-box;
      font-size: 14px;
    }
    .secondary-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      padding: 0 16px;
    }
    .secondary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .crop-stage {
      position: relative;
      border-radius: var(--lu-radius-tile);
      overflow: hidden;
      background: #050607;
      touch-action: none;
    }
    .source-img {
      display: block;
      width: 100%;
      height: auto;
      max-height: 320px;
      object-fit: contain;
    }
    .crop-box {
      position: absolute;
      border: 2px solid var(--lu-accent);
      box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.45);
      touch-action: none;
      cursor: move;
    }
    .handle {
      position: absolute;
      width: 16px;
      height: 16px;
      margin: -8px;
      background: #fff;
      border: 2px solid var(--lu-accent);
      border-radius: 50%;
      touch-action: none;
    }
    .handle-nw { top: 0; left: 0; cursor: nwse-resize; }
    .handle-n { top: 0; left: 50%; cursor: ns-resize; }
    .handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
    .handle-e { top: 50%; left: 100%; cursor: ew-resize; }
    .handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
    .handle-s { top: 100%; left: 50%; cursor: ns-resize; }
    .handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
    .handle-w { top: 50%; left: 0; cursor: ew-resize; }
    .crop-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .preview-plate {
      aspect-ratio: 2 / 1;
      width: 100%;
      border-radius: var(--lu-radius-tile);
      overflow: hidden;
      background: #050607;
      border: 1px solid var(--lu-edge);
    }
    .skeleton {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #0a0b0c 25%, #16181a 37%, #0a0b0c 63%);
      background-size: 400% 100%;
      animation: import-shimmer 1.4s ease infinite;
    }
    @keyframes import-shimmer {
      0% { background-position: 100% 0; }
      100% { background-position: 0 0; }
    }
    .disclosure {
      display: flex;
      align-items: center;
      gap: 6px;
      align-self: flex-start;
      min-height: var(--lu-target, 48px);
      padding: 0 14px;
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--lu-edge);
      background: var(--lu-tile);
      color: var(--lu-ink);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .adjust {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px;
      border-radius: var(--lu-radius-tile);
      background: var(--lu-tile);
    }
    .adjust-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--lu-ink-2);
    }
    .crop-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    @container (min-width: 360px) {
      .crop-grid,
      .two-up {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .two-up {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .stepper-field {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--lu-ink-2);
    }
    .background-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .background-row input[type="color"] {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      overflow: hidden;
      padding: 0;
      background: none;
      cursor: pointer;
    }
    .link-button {
      background: none;
      border: none;
      color: var(--lu-accent);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 0;
    }
    .link-row {
      display: flex;
      align-items: center;
      gap: 4px;
      align-self: flex-start;
      background: none;
      border: none;
      color: var(--lu-ink-2);
      font-size: 13px;
      cursor: pointer;
      padding: 4px 0;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      background: none;
      border: none;
      padding: 6px 0;
      min-height: var(--lu-target, 48px);
      color: var(--lu-ink);
      cursor: pointer;
      text-align: left;
      font-size: 14px;
    }
    .toggle-label {
      flex: 1;
    }
    .toggle-pill {
      flex: none;
      width: 40px;
      height: 24px;
      border-radius: var(--lu-radius-pill);
      background: var(--lu-track-off);
      position: relative;
    }
    .toggle-pill.on {
      background: var(--lu-accent);
    }
    .toggle-knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      transition: transform var(--lu-motion-focus) var(--lu-ease);
    }
    .toggle-pill.on .toggle-knob {
      transform: translateX(16px);
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 4px;
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
      }
      .skeleton {
        animation: none;
        background: #0f1112;
      }
    }
    `];customElements.define("iledclock-import-sheet",Ie);var Hs=10,Rs="Untitled design";function Ds(){return`local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}var Os=3e3,Fs=20,Te=class extends g{constructor(){super();this._unsubscribe=null;this._onFrameChanged=e=>{let t=this._frames.slice();t[this._activeFrameIndex]=e.detail.frame,this._pushFrames(t)};this._onColorPicked=e=>{this._activeColor=e.detail.color;let t=e.detail.color.join(",");this._recentColors=[e.detail.color,...this._recentColors.filter(s=>s.join(",")!==t)].slice(0,Hs)};this._onUndoRequested=()=>{this._history=Qi(this._history),this._activeFrameIndex=Math.min(this._activeFrameIndex,this._frames.length-1)};this._onRedoRequested=()=>{this._history=Ji(this._history),this._activeFrameIndex=Math.min(this._activeFrameIndex,this._frames.length-1)};this._onFramesChanged=e=>{this._pushFrames(e.detail.frames),this._activeFrameIndex=Math.min(this._activeFrameIndex,e.detail.frames.length-1)};this._onFrameSelected=e=>{this._activeFrameIndex=e.detail.index};this._onDelayChanged=e=>{let t=this._frames.slice(),s=t[e.detail.index];s&&(t[e.detail.index]={...s,durationMs:e.detail.delayMs},this._pushFrames(t))};this._onPlayToggled=e=>{this._playing=e.detail.playing};this._onGalleryDesignsChanged=()=>{this._entryId&&this._loadDesigns(this._entryId)};this._onGalleryOpenDesign=async e=>{this._entryId&&await this._loadDesigns(this._entryId);let t=this._designs.find(s=>s.id===e.detail.design_id);t&&(this._history=Le(T(t)),this._activeFrameIndex=0,this._currentDesignId=t.id,this._designName=t.name,this._nav="editor",this._importSheetOpen=!1)};this._onDesignSelected=e=>{let t=this._designs.find(s=>s.id===e.detail.id);t&&(this._history=Le(T(t)),this._activeFrameIndex=0,this._currentDesignId=t.id,this._designName=t.name)};this._onSaveClick=async()=>{this._busy="save";let e=await this._saveDesign(this._currentDesignId,this._frames,this._designName);e&&(this._currentDesignId=e),this._busy=null};this._onDesignRenameRequested=async e=>{let t=this._designs.find(s=>s.id===e.detail.id);t&&await this._saveDesign(t.id,T(t),e.detail.name)};this._onDesignDuplicateRequested=async e=>{let t=this._designs.find(s=>s.id===e.detail.id);t&&await this._saveDesign(null,T(t),`${t.name} copy`)};this._onDesignDeleteRequested=async e=>{if(this.hass.callWS)try{await this.hass.callWS($i(e.detail.id)),this._currentDesignId===e.detail.id&&(this._currentDesignId=null),this._entryId&&this._loadDesigns(this._entryId)}catch(t){this._error=t instanceof Error?t.message:"Delete failed."}};this._onSendConfirmed=async()=>{if(!(!this._entryId||!this.hass.callWS)){this._busy="send",this._error=null;try{let e=this._currentDesignId;if(e=await this._saveDesign(e,this._frames,this._designName),!e)return;this._currentDesignId=e,await this.hass.callWS(H(this._entryId,{design_id:e}))}catch(e){this._error=e instanceof Error?e.message:"Send failed."}finally{this._busy=null}}};this._onPlaylistItemsChanged=e=>{this._playlist=e.detail.items};this._onSavePlaylistConfirmed=async()=>{if(!(!this._entryId||!this.hass.callWS)){this._busy="playlist",this._error=null;try{let e=Ci(this._playlist,this._envelope?.capabilities.max_playlist_items??9);await this.hass.callWS(Si(this._entryId,e)),this._playlist=e}catch(e){this._error=e instanceof Error?e.message:"Saving the playlist failed."}finally{this._busy=null}}};this.narrow=!1,this._envelope=null,this._history=Le([P(32,16)]),this._activeFrameIndex=0,this._activeColor=[34,225,232],this._recentColors=[],this._wrap=!1,this._designs=[],this._designsLoading=!1,this._designName=Rs,this._currentDesignId=null,this._playlist=[],this._playing=!1,this._uploadProgress=null,this._nav="editor",this._importSheetOpen=!1,this._generativeKind=Qe[0].kind,this._generativeSeconds=8,this._busy=null,this._error=null}connectedCallback(){super.connectedCallback(),this.addEventListener("iledclock-designs-changed",this._onGalleryDesignsChanged),this.addEventListener("iledclock-open-design",this._onGalleryOpenDesign)}disconnectedCallback(){super.disconnectedCallback(),this.removeEventListener("iledclock-designs-changed",this._onGalleryDesignsChanged),this.removeEventListener("iledclock-open-design",this._onGalleryOpenDesign),this._unsubscribe&&this._unsubscribe()}willUpdate(e){if(!e.has("hass")&&!e.has("deviceId")||!this.hass)return;let t=this.deviceId??this._autoDeviceId(),s=Ye(this.hass.devices,t);this._entryId=s,s&&s!==this._lastEntryIdSubscribed&&(this._lastEntryIdSubscribed=s,this._connect(s),this._loadDesigns(s),this._loadPlaylist(s))}_autoDeviceId(){return Object.values(this.hass.entities??{}).find(t=>t.platform==="iledclock")?.device_id??void 0}async _connect(e,t=0){if(this._unsubscribe&&(this._unsubscribe(),this._unsubscribe=null),!!this.hass.callWS)try{this._envelope=await this.hass.callWS({type:"iledclock/state",entry_id:e}),this.hass.connection&&(this._unsubscribe=await this.hass.connection.subscribeMessage(s=>{s.type==="upload"?(this._uploadProgress=s,(s.state==="done"||s.state==="error")&&setTimeout(()=>this._uploadProgress=null,2500)):this._envelope=s},{type:"iledclock/subscribe",entry_id:e})),t>0&&this._loadPlaylist(e)}catch(s){s?.code==="unknown_entry"&&t<Fs&&this.isConnected&&setTimeout(()=>void this._connect(e,t+1),Os)}}async _loadDesigns(e){if(this.hass.callWS){this._designsLoading=!0;try{this._designs=await this.hass.callWS(Ke(e))}catch(t){this._error=t instanceof Error?t.message:"Could not load the design library."}finally{this._designsLoading=!1}}}async _loadPlaylist(e){if(this.hass.callWS)try{let t=await this.hass.callWS(ki(e));this._playlist=t.playlist??[]}catch{this._playlist=[]}}get _frames(){return this._history.present}_pushFrames(e){this._history=Xi(this._history,e)}_replaceDesign(e,t){this._history=Le(e),this._activeFrameIndex=0,this._currentDesignId=null,t&&(this._designName=t)}async _renderInto(e,t){if(!(!this._entryId||!this.hass.callWS)){this._busy="render",this._error=null;try{let s=await this.hass.callWS(te(this._entryId,e)),n=s.frames.map((o,a)=>{let d=atob(o),p=new Uint8Array(32*16*3);for(let u=0;u<Math.min(d.length,p.length);u++)p[u]=d.charCodeAt(u);return{width:32,height:16,pixels:p,durationMs:s.delays[a]??100}});n.length>0&&this._replaceDesign(n,t)}catch(s){this._error=s instanceof Error?s.message:"Import failed."}finally{this._busy=null}}}_runGenerative(){this._renderInto({type:"generative",kind:this._generativeKind,seconds:this._generativeSeconds},Qe.find(e=>e.kind===this._generativeKind)?.label??"Generative")}async _saveDesign(e,t,s){if(!this.hass.callWS)return null;let n=Date.now(),o=e?this._designs.find(d=>d.id===e):void 0,a=Oi(t,{id:e??Ds(),name:s,kind:t.length>1?"animation":"image",created:o?.created??n,updated:n,tags:o?.tags});try{let d=await this.hass.callWS(wi(a));return this._entryId&&this._loadDesigns(this._entryId),d.id}catch(d){return this._error=d instanceof Error?d.message:"Save failed.",null}}_toggleMenu(){this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:!0,composed:!0}))}render(){let e=this._frames,t=e[this._activeFrameIndex]??e[0],s=this._activeFrameIndex>0?e[this._activeFrameIndex-1]??null:null;return l`
      <div class="app-bar">
        ${this.narrow?l`<button type="button" class="icon-button" @click=${()=>this._toggleMenu()} aria-label="Show sidebar">${m("menu")}</button>`:c}
        <h1>Pixel Studio</h1>
        <iledclock-segmented-picker
          class="nav-picker"
          group-label="Section"
          content-fit
          .options=${[{value:"editor",label:"Editor"},{value:"gallery",label:"Gallery"}]}
          .value=${this._nav}
          @option-selected=${n=>this._nav=n.detail.value}
        ></iledclock-segmented-picker>
        ${this._uploadProgress?l`<span class="upload-status">${this._renderUploadStatus(this._uploadProgress)}</span>`:c}
      </div>
      <div class="body">
        ${this._error?l`<p class="error">${this._error}</p>`:c}
        ${this._nav==="gallery"?l`<div class="gallery-view"><iledclock-gallery-browser .hass=${this.hass} .entryId=${this._entryId}></iledclock-gallery-browser></div>`:l`
              <div class="editor-column">
                <div class="name-row">
                  <input class="design-name" type="text" .value=${this._designName} @change=${n=>this._designName=n.target.value} placeholder="Design name" />
                  <button type="button" class="secondary-action" @click=${()=>this._importSheetOpen=!0}>${m("image")} Import</button>
                </div>
                <iledclock-pixel-editor
                  .frame=${t}
                  .onionSkin=${s}
                  .wrap=${this._wrap}
                  .activeColor=${this._activeColor}
                  .recentColors=${this._recentColors}
                  .hass=${this.hass}
                  .entryId=${this._entryId}
                  @frame-changed=${this._onFrameChanged}
                  @color-picked=${this._onColorPicked}
                  @undo-requested=${this._onUndoRequested}
                  @redo-requested=${this._onRedoRequested}
                ></iledclock-pixel-editor>
                <iledclock-frame-timeline
                  .frames=${e}
                  .activeIndex=${this._activeFrameIndex}
                  .playing=${this._playing}
                  @frames-changed=${this._onFramesChanged}
                  @frame-selected=${this._onFrameSelected}
                  @delay-changed=${this._onDelayChanged}
                  @play-toggled=${this._onPlayToggled}
                ></iledclock-frame-timeline>
                ${this._renderGenerativeSection()}
                <div class="button-row">
                  <button type="button" class="secondary-action" ?disabled=${this._busy==="save"} @click=${this._onSaveClick}>${m("save")} Save</button>
                  <iledclock-hold-button label="Hold to send to clock" complete-label="Sent" ?disabled=${this._busy==="send"||!this._entryId} @confirmed=${this._onSendConfirmed}></iledclock-hold-button>
                </div>
              </div>
              <div class="side-column">
                <iledclock-library-panel
                  .designs=${this._designs}
                  .loading=${this._designsLoading}
                  @design-selected=${this._onDesignSelected}
                  @design-rename-requested=${this._onDesignRenameRequested}
                  @design-duplicate-requested=${this._onDesignDuplicateRequested}
                  @design-delete-requested=${this._onDesignDeleteRequested}
                ></iledclock-library-panel>
                <iledclock-playlist-editor
                  .items=${this._playlist}
                  .maxItems=${this._envelope?.capabilities.max_playlist_items??9}
                  .designs=${this._designs}
                  @items-changed=${this._onPlaylistItemsChanged}
                ></iledclock-playlist-editor>
                <iledclock-hold-button
                  label="Hold to save playlist to clock"
                  complete-label="Saved"
                  danger
                  ?disabled=${this._busy==="playlist"||!this._entryId}
                  @confirmed=${this._onSavePlaylistConfirmed}
                ></iledclock-hold-button>
              </div>
            `}
      </div>
      <iledclock-import-sheet .hass=${this.hass} .entryId=${this._entryId} ?open=${this._importSheetOpen} @close-requested=${()=>this._importSheetOpen=!1}></iledclock-import-sheet>
    `}_renderUploadStatus(e){return e.state==="error"?`Upload failed${e.error?`: ${e.error}`:""}`:e.state==="done"?"Upload complete":`Uploading ${e.program+1}/${e.programs} \u2013 chunk ${e.chunk+1}/${e.chunks}`}_renderGenerativeSection(){return l`
      <div class="import-section">
        <div class="generative-row">
          <select class="generative-select" @change=${e=>this._generativeKind=e.target.value}>
            ${Qe.map(e=>l`<option value=${e.kind} ?selected=${e.kind===this._generativeKind}>${e.label}</option>`)}
          </select>
          <button type="button" class="secondary-action" ?disabled=${this._busy==="render"} @click=${this._runGenerative}>${m("generative")} Generate</button>
        </div>
      </div>
    `}};Te.properties={hass:{attribute:!1},narrow:{type:Boolean},deviceId:{attribute:"device-id"},_entryId:{state:!0},_envelope:{state:!0},_history:{state:!0},_activeFrameIndex:{state:!0},_activeColor:{state:!0},_recentColors:{state:!0},_wrap:{state:!0},_designs:{state:!0},_designsLoading:{state:!0},_designName:{state:!0},_currentDesignId:{state:!0},_playlist:{state:!0},_playing:{state:!0},_uploadProgress:{state:!0},_nav:{state:!0},_importSheetOpen:{state:!0},_generativeKind:{state:!0},_generativeSeconds:{state:!0},_busy:{state:!0},_error:{state:!0}},Te.styles=[y,_`
    :host {
      display: block;
      height: 100vh;
      background: var(--primary-background-color);
      color: var(--lu-ink);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .app-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
      height: 56px;
      flex: none;
      background: var(--app-header-background-color, var(--primary-background-color));
      border-bottom: 1px solid var(--divider-color);
    }
    .nav-picker {
      /* The picker is a size container (container-type: inline-size), so it has no intrinsic
         width: in this flex row it collapsed to 0 px beside the title. Give it a definite one. */
      flex: 0 0 220px;
      width: 220px;
    }
    h1 {
      font-size: 18px;
      font-weight: 700;
      margin: 0;
      flex: 1;
    }
    .icon-button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--primary-text-color);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .upload-status {
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .body {
      flex: 1;
      overflow-y: auto;
      container-type: inline-size;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .error {
      margin: 0;
      color: var(--lu-danger);
      font-size: 13px;
    }
    .editor-column,
    .side-column {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .name-row {
      display: flex;
      gap: 8px;
    }
    .design-name {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 12px;
      font-size: 15px;
      font-weight: 600;
    }
    .gallery-view {
      min-height: 0;
      flex: 1;
    }
    .import-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border-radius: var(--lu-radius-tile);
      border: 1px solid var(--divider-color);
    }
    .generative-row {
      display: flex;
      gap: 8px;
    }
    .generative-select {
      flex: 1;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-control);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 10px;
    }
    .button-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .button-row iledclock-hold-button {
      flex: 1;
    }
    .secondary-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: var(--lu-target, 48px);
      border-radius: var(--lu-radius-pill);
      border: 1px solid var(--divider-color);
      background: none;
      color: var(--primary-text-color);
      cursor: pointer;
      padding: 0 16px;
      font-size: 14px;
      font-weight: 600;
      transition: transform 90ms var(--lu-ease, ease);
    }
    .secondary-action:active:not(:disabled) {
      transform: scale(0.97);
    }
    .secondary-action:disabled {
      opacity: 0.5;
      cursor: default;
    }
    @container (min-width: 900px) {
      .body {
        flex-direction: row;
        align-items: flex-start;
      }
      .editor-column {
        flex: 1 1 62%;
      }
      .side-column {
        flex: 1 1 38%;
        position: sticky;
        top: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      * {
        transition: none !important;
        animation: none !important;
      }
    }
  `];customElements.define("iledclock-studio-panel",Te);
