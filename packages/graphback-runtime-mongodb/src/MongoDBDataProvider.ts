import { GraphQLObjectType } from 'graphql';
import { ObjectId, Db, Cursor } from "mongodb"
import { ModelTableMap, buildModelTableMap, getDatabaseArguments } from '@graphback/core';
import { GraphbackDataProvider, GraphbackPage, NoDataError, AdvancedFilter } from '@graphback/runtime';

/**
 * Graphback provider that connnects to the MongoDB database
 */
export class MongoDBDataProvider<Type = any, GraphbackContext = any> implements GraphbackDataProvider<Type, GraphbackContext>{
  protected db: Db;
  protected collectionName: string;
  protected tableMap: ModelTableMap;

  public constructor(baseType: GraphQLObjectType, db: any) {
    this.db = db;
    this.tableMap = buildModelTableMap(baseType);
    this.collectionName = this.tableMap.tableName;
  }

  public async create(data: any): Promise<Type> {
    const { idField } = getDatabaseArguments(this.tableMap, data);
    if (data && data[idField.name]) {
      // Ignore id passed from client side. In case id is passed it should not be saved
      // eslint-disable-next-line @typescript-eslint/tslint/config
      delete data[idField.name];
    }

    const result = await this.db.collection(this.collectionName).insertOne(data);
    if (result && result.ops) {
      result.ops[0][idField.name] = result.ops[0]._id;

      return result.ops[0];
    }
    throw new NoDataError(`Cannot create ${this.collectionName}`);
  }

  public async update(data: Type): Promise<Type> {
    const { idField } = getDatabaseArguments(this.tableMap, data);
    const result = await this.db.collection(this.collectionName).updateOne({ _id: new ObjectId(idField.value) }, { $set: data });
    if (result) {
      const queryResult = await this.db.collection(this.collectionName).find({ _id: new ObjectId(idField.value) }).toArray();
      if (queryResult && queryResult[0]) {
        queryResult[0][idField.name] = queryResult[0]._id;

        return queryResult[0];
      }
    }
    throw new NoDataError(`Cannot update ${this.collectionName}`);
  }

  public async delete(data: Type): Promise<Type> {
    const { idField } = getDatabaseArguments(this.tableMap, data);

    const queryResult = await this.db.collection(this.collectionName).findOne({ _id: new ObjectId(idField.value) });
    if (queryResult) {
      const result = await this.db.collection(this.collectionName).deleteOne({ _id: new ObjectId(idField.value) });
      if (result.result.ok) {
        queryResult[idField.name] = queryResult._id;

        return queryResult;
      }
    }
    throw new NoDataError(`Cannot update ${this.collectionName}`);
  }

  public async findAll(page?: GraphbackPage): Promise<Type[]> {
    const query = this.db.collection(this.collectionName).find({});
    const data = await this.usePage(query, page);

    if (data) {
      return data.map((one: any) => {
        return {
          ...one,
          id: one._id
        }
      });
    }
    throw new NoDataError(`Cannot find all results for ${this.collectionName}`);
  }

  public async findBy(filter: Type | AdvancedFilter, page?: GraphbackPage): Promise<Type[]> {
    let dbResult;
    const { idField } = getDatabaseArguments(this.tableMap, filter);
    // TODO MongoDB should use advanced filter with JSON scalar defined as InputType
    if (filter[idField.name]) {
      const query = this.db.collection(this.collectionName).
        find({ _id: new ObjectId(filter[idField.name]) });
      dbResult = await this.usePage(query, page);
    } else {
      const query = this.db.collection(this.collectionName).find(filter);
      dbResult = await this.usePage(query, page);
    }
    if (dbResult) {
      return dbResult.map((one: any) => {
        return {
          ...one,
          id: one._id
        }
      });
    }
    throw new NoDataError(`No results for ${this.collectionName} query and filter: ${JSON.stringify(filter)}`);
  }

  public async batchRead(relationField: string, ids: string[]): Promise<Type[][]> {
    let result: any;

    const { idField } = getDatabaseArguments(this.tableMap);

    if (relationField === idField.name) {
      relationField = "_id";
      const array = ids.map((value: string) => {
        return new ObjectId(value);
      });
      result = await this.db.collection(this.collectionName).find({ _id: { $in: array } }).toArray();
    } else {
      const query: any = {};
      query[relationField] = { $in: ids };
      result = await this.db.collection(this.collectionName).find(query).toArray();
    }

    if (result) {
      const resultsById = ids.map((id: string) => result.filter((data: any) => {
        if (data[relationField].toString() === id.toString()) {
          return {
            ...data,
            id: data._id
          }
        }
      }));

      return resultsById as [Type[]];
    }

    throw new NoDataError(`No results for ${this.collectionName} query and batch read`);



  }

  private usePage(query: Cursor<any>, page?: GraphbackPage, defaultLimit: number = 10, defaultOffset: number = 0) {
    if (page) {
      page.limit = page.limit || defaultLimit
      page.offset = page.offset || defaultOffset
      
      return query.skip(page.offset).limit(page.limit).toArray();
    } else {
      return query.toArray();
    }
  }

}
