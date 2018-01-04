'use strict';

const bemImport = require('@bem/import-notation');
const bemjsonToDecl = require('bemjson-to-decl');
const bemjsonToJSX = require('bemjson-to-jsx');
const nEval = require('node-eval');
const BemEntity = require('@bem/entity-name');
const naming = require('@bem/naming');
const bemWalk = require('@bem/walk');
const through = require('through2');
const loaderUtils = require('loader-utils');
const pascalCase = require('pascal-case');

const reactTMPL = (imports, JSX) =>
`
import React from 'react';
import ReactDOM from 'react-dom';
${imports}

ReactDOM.render(
  ${JSX},
  document.getElementById('root')
);
`;

const fs = require('fs');
const is_debug = process.env.DEBUG || false;

module.exports = function(source) {
    this.cacheable && this.cacheable();
    const callback = this.async();

    const options = Object.assign({},
        this.options.bemLoader,
        loaderUtils.getOptions(this)
    );
    const levels = options.levels;
    const techs = options.techs || ['js'];
    const bemPath = options.bemPath;
    const plugins = options.bemjsonToJSXPlugins || [];
    const bJSXopts = options.bemjsonToJSXOptions || {};
    const techMap = techs.reduce((acc, tech) => {
        acc[tech] || (acc[tech] = [tech]);
        return acc;
    }, options.techMap || {});
    const extToTech = Object.keys(techMap).reduce((acc, tech) => {
        techMap[tech].forEach(ext => {
            acc[ext] = tech;
        });
        return acc;
    }, {});
    const defImportResolver = (className, entity, entities) => {
        return [`import ${className} from '${bemImport.stringify(entities)}';`];
    };
    const importResolver = options.bemjsonToJSXImportResolver || defImportResolver;

    new Promise((resolve, rej) => {
        const bemjson = nEval(source);
        is_debug && fs.writeFileSync('/tmp/debug-bemjson.json', JSON.stringify(bemjson, null, 4));

        // whiteLists of entities on project level
        const whiteList = [];
        const cssList = [];
        const jsList = [];

        const walk = bemWalk(levels).pipe(through.obj((entity, _, next) => {
            next(null, extToTech[entity.tech] ? entity : null);
        }));
        walk.on('data', file => {
            whiteList.push(file.cell.entity);
            ~techMap['css'].indexOf(file.tech) && cssList.push(file.cell.entity)
            ~techMap['js'].indexOf(file.tech) && jsList.push(file.cell.entity)
        });
        walk.on('error', err => rej(err));
        walk.on('end', () => {

            const imports = [];

            bemjsonToDecl.convert(bemjson)
                .map(BemEntity.create)
                .filter(entity => whiteList.some(white => entity.isEqual(white)))
                .reduce((acc, entity) => {
                    // group by block and elems
                    const entityId = BemEntity.create({ block: entity.block, elem: entity.elem }).toString();
                    acc.has(entityId) ? acc.get(entityId).push(entity) : acc.set(entityId, [entity]);
                    return acc;
                }, new Map())
                .forEach((entities, entityId) => {
                    const entity = naming.parse(entityId);
                    const className = pascalCase(entityId);
                    imports.push(...importResolver(className, entity, entities));
                });

            bemPath && imports.push(`import Bem from '${bemPath}';`);

            const whiteListPlugin = function(jsx, json) {
                // Plugin to fullfill css-only blocks
                if (jsx.bemEntity) {
                    if (!jsList.some(white => jsx.bemEntity.isEqual(white))) {
                        if (
                            bemPath &&
                            cssList.some(white => jsx.bemEntity.isEqual(white) || jsx.bemEntity.belongsTo(white))
                        ) {
                            jsx.tag = 'bem';
                            jsx.props.block = json.block;
                            json.mods && (jsx.props.mods = json.mods);
                            json.elem && (jsx.props.elem = json.elem);
                            json.elemMods && (jsx.props.mods = json.elemMods);
                            jsx.bemEntity = new BemEntity({ block: 'bem' });
                        } else {
                            // no js, no css
                            return '';
                        }
                    } else {
                        jsx.tag = pascalCase(jsx.tag);
                    }
                }
                // Fix it with knownComponents: #issues/6 and updating on bem-react-core <= 1.0.0
                jsx.props.style &&
                    (jsx.props.attrs = Object.assign({ 'style' : jsx.props.style }, jsx.props.attrs));
            };
            const JSX = bemjsonToJSX(bJSXopts).use([whiteListPlugin].concat(plugins)).process(bemjson).JSX;

            const res = reactTMPL(imports.join('\n'), JSX);
            is_debug && fs.writeFileSync('/tmp/debug-jsx.html', res);
            resolve(res);
        });
    })
    .then(res => callback(null, res))
    .catch(callback);
};
