import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Response } from '@angular/http/src/static_response';
import { Observable } from 'rxjs/Observable';
import { map } from 'rxjs/operators';
import 'rxjs/add/operator/toPromise';

// Libs terceros
import * as _ from 'lodash';
import * as moment from 'moment';
import PouchDB from 'pouchdb';
import * as PouchUpsert from 'pouchdb-upsert';
import * as Loki from 'lokijs';

// AngularFire - Firebase
import { AngularFireDatabase, AngularFireObject } from 'angularfire2/database';
import * as firebase from 'firebase';

// Services
import { UtilsService } from '../../utils/utils.service';
// Models
import { AllOrdenesInfo } from './models/allOrdenesInfo';
import { BasicInfoOrden } from './models/basicInfoOrden';
import { Orden } from '../orden/models/orden';
import { Subscription } from '../../../../../node_modules/rxjs';

@Injectable()
export class VendedorService {

  private _remoteBD: PouchDB.Database; // Base de datos a la que voy a consultar
  private _vendedor: string = ''; // Nombre del vendodor al que le voy a consultar las ordenes
  // Url de la BD en couchDB con los usuarios de la app
  private _urlUsersCouchDB: string = 'https://vm257.tmdcloud.com:6984';
  // Credenciales
  private _userDB: string = 'admin';
  private _passDB: string = 'Webmaster2017#@';

  /**
   * En esta variable guardo una instancia de lokiDB,
   * lo que hago mas o menos es gurdar en esta bd en memoria es un
   * array de objetos, cada uno de estos objetos tiene el nombre del
   * vendedor y una info basica sobre las ordenes de ese vendedor (vease la interfaz "AllOrdenesInfo")
   * Y me preguntare, para que mierda darme la molestia de usar una bd en memoria, bueno seria por esto
   * al tratar de recuperar la info de los vendedores y sus ordenes tengo que consultar diferentes BDS
   * en couchdb una por cada vendedor, lo que vuelve muy lenta la consulta, el truco aqui es consultar una vez
   * y almacenar los datos en loki, de esta forma no tengo que estar consultando a couchdb que se demora mucho
   */
  private _lkVendedorDB: Loki;
  // Coleccion con la info de las ordens por cada vendedor
  private _lkOrdenesInfoTbl: Loki.Collection;
  private _lkIsInit: boolean = false; // Este atributo me sirve para verificar si ya cree la instancia de loki
  private _lkIsLoaded: boolean = false; // Este atributo me sirve para verificar si ya se hizo la primera carga de datos

  public vendedores: any[] = [];

  constructor(
    private angularFireDB: AngularFireDatabase,
    protected utils: UtilsService,
    private http: HttpClient,
  ) {
    PouchDB.plugin(PouchUpsert);
    this._initLokiDB();
  }

  private _initLokiDB(): void {
    if (!this._lkIsInit) {
      this._lkVendedorDB = new Loki('ordenesInfoDB'); // Creo la bd en loki
      // creo la coleccion que me va contener los datos
      this._lkOrdenesInfoTbl = this._lkVendedorDB.addCollection('ordenesInfo', {
        unique: ['vendedor'],
      });
      this._lkIsInit = true;
    }
  }

  public initFirebase(): Promise<any> {
    return firebase.database().ref('users/').once('value').then(res => {
      this.vendedores = res.val();
      return this.vendedores;
    });
  }

  public async  getAllVendedores(): Promise<string[]> {
    const url: string = `${this._urlUsersCouchDB}/_all_dbs`;
    const options = {
      headers: new HttpHeaders({
        'Accept'       : 'application/json',
        'Content-Type' : 'application/json',
        'Authorization': 'Basic ' + btoa(`${this._userDB}:${this._passDB}`),
      }),
    };

    const all_dbs: string[] = await this.http.get( url, options ).pipe(
      map( (res: string[]) => res),
    ).toPromise();

    const users: string[] = _.chain(all_dbs)
      .map((db, k, l): string => {
        const dbSplit: string[] = db.split('$');
        if ( dbSplit[0] === 'supertest' ) {
            return dbSplit[1];
        }
      })
      .compact()
      .value();

    return users;
  }

  /* public async getOrdenesVendedorOld(ids?: string[]): Promise<any> {
    const options: any = {
      include_docs : true,
    };
    if (ids) { options.keys = ids; }
    const vendedor = this._vendedor;
    const docs = await this._remoteBD.allDocs(options);
    return {
      vendedor: vendedor,
      docs: docs,
    };
  } */

  public async getOrdenesVendedor(ids?: string[]): Promise<any> {

    if (ids) {
      const ordenes = [];
      for ( const id of ids ) {
        const orden = await firebase.database().ref(`orders/${this._vendedor}/${id}`).once('value');
        ordenes.push( orden.val() );
      }

      return {
        vendedor: this._vendedor,
        ordenes: ordenes,
      };

    }

    const ordenes = await firebase.database().ref(`orders/${this._vendedor}`).once('value');
    return {
      vendedor: this._vendedor,
      ordenes: ordenes,
    };
  }

  public async formatOrdenesVendedor(): Promise<any> {
    const ordenesUsuario = await this.getOrdenesVendedor(); // traigo todas las ordenes del vendedor
    const ordenesUbicacion: Orden[] = [];

    const ordenes = _.map(ordenesUsuario.ordenes.val(), (orden: any) => {

      if ( _.has(orden, 'accuracy') ) {
        ordenesUbicacion.push(orden);
      }

      let statusOrder: string = '<span class="badge badge-success">Procesado</span>'; // row.doc.estado
      const hasntDocEntry: boolean = !_.has(orden, 'docEntry') || orden.docEntry === '';
      const hasError: boolean = _.has(orden, 'error') && orden.error;
      if ( hasntDocEntry ) { statusOrder = '<span class="badge badge-warning">Pendiente</span>'; }
      if ( hasError ) { statusOrder = '<span class="badge badge-danger">Error</span>'; }
      if ( String(orden.estado) === 'seen' ) { statusOrder = '<span class="badge badge-info">Revisado</span>'; }
      if ( String(orden.estado) === 'uploaded' ) { statusOrder = '<span class="badge badge-success">Procesado</span>'; }
      // tslint:disable-next-line:max-line-length
      const ubicacion: string =  _.has(orden, 'accuracy') ? '<span class="badge badge-success">Si</span>' : '<span class="badge badge-danger">No</span>';

      return {
        id         : orden._id,
        cliente    : orden.nitCliente,
        created_at : moment(parseInt(orden._id, 10)).format('YYYY-MM-DD'),
        total      : orden.total,
        cantItems  : orden.items.length,
        estado     : statusOrder,
        ubicacion  : ubicacion,
      };
    });

    return {
      ordenesInfo: ordenes,
      ordenesGps: ordenesUbicacion,
    };
  }

  /**
   * Esta funcion me devuleve un array de objetos, donde cada posicion corresponde
   * a un vendedor y la cantidad de ordenes que ha hecho, la cantidad de ordenes con errores
   * y la cantidad de ordenes pendientes y revisadas
   *
   * @returns {Promise<any>}
   * @memberof VendedorService
   */
  public async getOrdenesVendedores(): Promise<AllOrdenesInfo[]> {

    // limpio los datos de la coleccion para actualizarlos todos
    // tambien podria hacer un upsert, pero como en este caso
    // no estoy seguro de que valores cambiaron, entonces simplemente
    // vacio y creo toda la coneccion de nuevo para actualizarla
    // creo q asi gano un poco mas de performance
    this._lkOrdenesInfoTbl.clear();

    try {

      // tslint:disable-next-line:forin
      for (const vendedorKey in this.vendedores) {

        const result = await firebase.database().ref(`orders/${this.vendedores[vendedorKey].uid}`).once('value');

        let htmlErrores = '0'; // aqui guardo un html q basicamente en capsula el numero de errores en un badge
        const ordenesErr = []; // aqui guardo las ordenes que tienen errores de cada vendedor
        const ordenesPend = []; // aqui guardo las ordenes pendientes, osea las ordenes que aun no se han enviado a sap
        const ordenesVistas = []; // guardo las ordenes marcadas como vistas en la pag de administrador dio-brando

        if (result.val()) {

          const ordenes = result.val();
          // tslint:disable-next-line:forin
          for (const ordenKey in ordenes) {
            /**
             * si un pedido no tiene docEntry esta variable pasa a ser "true",
             * el hecho de q un pedido no tenga docEntry casi siempre significa
             * que esta pendiente, no ha subido a sap
            */

            const hasntDocEntry: boolean = !_.has(ordenes[ordenKey], 'docEntry') || ordenes[ordenKey].docEntry === '';
            // si el pedido tiene un error esta variable pasa a true
            const hasError: boolean = _.has(ordenes[ordenKey], 'error') && ordenes[ordenKey].error;
            // Verifico si la orden de la posicion actual tiene un error y la meto en el array respectivo
            if (hasError) {
              ordenesErr.push(ordenes[ordenKey]);
            }
            // Verifico si la orden esta pendiente y no tiene errores
            if (hasntDocEntry && String(ordenes[ordenKey].estado) !== 'uploaded') {
              if (!hasError) {
                ordenesPend.push(ordenes[ordenKey]);
              }
            }
            // verifico si la orden esta marcada como vista
            if (String(ordenes[ordenKey].estado) === 'seen') { ordenesVistas.push(ordenes[ordenKey]); }

          }

          if (ordenesErr.length - ordenesVistas.length > 0) {
            htmlErrores = `<span class="badge badge-danger">${ordenesErr.length - ordenesVistas.length}</span>`;
          }

          this._lkOrdenesInfoTbl.insert({
            'vendedor': this.vendedores[vendedorKey].username,
            'idAsesor': this.vendedores[vendedorKey].idAsesor,
            'vendedorData': this.vendedores[vendedorKey],
            'numOrdenes': Object.keys(ordenes).length,
            'numOrdenesErr': htmlErrores,
            'numOrdenesPend': ordenesPend.length,
            'numOrdenesVistas': ordenesVistas.length,
          });

        } else {
          this._lkOrdenesInfoTbl.insert({
            'vendedor': this.vendedores[vendedorKey].username,
            'idAsesor': this.vendedores[vendedorKey].idAsesor ? this.vendedores[vendedorKey].idAsesor : 'Inactivo',
            'vendedorData': this.vendedores[vendedorKey],
            'numOrdenes': 0,
            'numOrdenesErr': 0,
            'numOrdenesPend': 0,
            'numOrdenesVistas': 0,
          });
        }

      }

    } catch (err) {
      console.error('error al recuperar las ordenes de los vendedores', err);
      window.alert('Error al recuperar las ordenes de los vendedores');
    }

    this._lkIsLoaded = true;
    return this.allOrdenesInfo;
  }

  /**
   * Performs an upsert.
   * This means performing an update if the record exists, or performing an
   * insert if it doesn't.
   * LokiJS (as at version 1.2.5) lacks this function.
   * TODO: Remove this function when LokiJS has built-in support for upserts.
   * @param {object} collection - The target DB collection.
   * @param {string} idField - The field which contains the record's unique ID.
   * @param {object} record - The record to be upserted.
   * @depends lodash
   * @example
   * this._lkUpsert(coleccion_objetivo, 'nombre_campo_unico_coleccion', {
   *   'nombre_campo_unico_coleccion' : '123457',
   *   'propietario'                  : 'marcos',
   *   'telefono'                     : 21232131
   * });
   */
  private _lkUpsert(collection: Loki.Collection, idField, record): void {
    const existingRecord = collection.by(idField, record[idField]);
    if (existingRecord) {
      // The record exists. Do an update.
      const updatedRecord = existingRecord;
      // Only update the fields contained in `record`. All fields not contained
      // in `record` remain unchanged.
      for ( const key in record ) {
        if (record.hasOwnProperty(key)) {
          updatedRecord[key] = record[key];
        }
      }
      collection.update(updatedRecord);
    } else {
      // The record doesn't exist. Do an insert.
      collection.insert(record);
    }
  }

  // VOY AQUI CONTINUAR CON EL CAMBIO DE ESTADO DE LAS ORDENES

  public async cambiarEstado(idDoc: string, estado: string): Promise<any> {

    const ordenRef: AngularFireObject<any> = this.angularFireDB.object(`orders/${this._vendedor}/${idDoc}`);

    if (estado === 'uploaded'){
      return await ordenRef.update({
        updated_at: Date.now().toString(),
        estado: estado,
        error: '',
      });
    }

    return await ordenRef.update({
      updated_at: Date.now().toString(),
      estado: estado,
    });

  }

  public async eliminarOrden(idDoc: string): Promise<any> {
    const res = await this._remoteBD.upsert(idDoc, (orden: any) => {
      orden._deleted = true;
      return orden;
    });

    return res;
  }

  public set bdName(v: string) {
    this._vendedor = v;
  }

  public get lkIsInit(): boolean {
    return this._lkIsInit;
  }

  public get lkIsLoaded(): boolean {
    return this._lkIsLoaded;
  }

  public get allOrdenesInfo(): AllOrdenesInfo[] {
    return this._lkOrdenesInfoTbl.find();
  }

}
