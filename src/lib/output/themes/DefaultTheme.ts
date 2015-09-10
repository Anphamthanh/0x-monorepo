import * as Path from "path";
import * as FS from "fs";

import {Theme} from "../Theme";
import {IParameterProvider, IParameter, ParameterType} from "../../Options";
import {Renderer} from "../Renderer";
import {Reflection, ReflectionKind, ProjectReflection, ContainerReflection, DeclarationReflection} from "../../models/reflections/index";
import {ReflectionGroup} from "../../models/ReflectionGroup";
import {UrlMapping} from "../models/UrlMapping";
import {NavigationItem} from "../models/NavigationItem";
import {OutputEvent} from "../events/OutputEvent";


/**
 * Defines a mapping of a [[Models.Kind]] to a template file.
 *
 * Used by [[DefaultTheme]] to map reflections to output files.
 */
export interface ITemplateMapping
{
    /**
     * [[DeclarationReflection.kind]] this rule applies to.
     */
    kind:ReflectionKind[];

    /**
     * Can this mapping have children or should all further reflections be rendered
     * to the defined output page?
     */
    isLeaf:boolean;

    /**
     * The name of the directory the output files should be written to.
     */
    directory:string;

    /**
     * The name of the template that should be used to render the reflection.
     */
    template:string;
}


/**
 * Default theme implementation of TypeDoc. If a theme does not provide a custom
 * [[BaseTheme]] implementation, this theme class will be used.
 */
export class DefaultTheme extends Theme implements IParameterProvider
{
    /**
     * Mappings of reflections kinds to templates used by this theme.
     */
    static MAPPINGS:ITemplateMapping[] = [{
        kind:      [ReflectionKind.Class],
        isLeaf:    false,
        directory: 'classes',
        template:  'reflection.hbs'
    },{
        kind:      [ReflectionKind.Interface],
        isLeaf:    false,
        directory: 'interfaces',
        template:  'reflection.hbs'
    },{
        kind:      [ReflectionKind.Enum],
        isLeaf:    false,
        directory: 'enums',
        template:  'reflection.hbs'
    },{
        kind:      [ReflectionKind.Module, ReflectionKind.ExternalModule],
        isLeaf:    false,
        directory: 'modules',
        template:  'reflection.hbs'
    }];



    /**
     * Create a new DefaultTheme instance.
     *
     * @param renderer  The renderer this theme is attached to.
     * @param basePath  The base path of this theme.
     */
    constructor(renderer:Renderer, basePath:string) {
        super(renderer, basePath);
        renderer.on(Renderer.EVENT_BEGIN, this.onRendererBegin, this, 1024);
    }


    /**
     * Test whether the given path contains a documentation generated by this theme.
     *
     * @param path  The path of the directory that should be tested.
     * @returns     TRUE if the given path seems to be a previous output directory,
     *              otherwise FALSE.
     */
    isOutputDirectory(path:string):boolean {
        if (!FS.existsSync(Path.join(path, 'index.html'))) return false;
        if (!FS.existsSync(Path.join(path, 'assets'))) return false;
        if (!FS.existsSync(Path.join(path, 'assets', 'js', 'main.js'))) return false;
        if (!FS.existsSync(Path.join(path, 'assets', 'images', 'icons.png'))) return false;

        return true;
    }


    getParameters():IParameter[] {
        return <IParameter[]>[{
            name: 'gaID',
            help: 'Set the Google Analytics tracking ID and activate tracking code.'
        },{
            name: 'gaSite',
            help: 'Set the site name for Google Analytics. Defaults to `auto`.',
            defaultValue: 'auto'
        },{
            name: 'hideGenerator',
            help: 'Do not print the TypeDoc link at the end of the page.',
            type: ParameterType.Boolean
        },{
            name: 'entryPoint',
            help: 'Specifies the fully qualified name of the root symbol. Defaults to global namespace.',
            type: ParameterType.String
        }];
    }


    /**
     * Map the models of the given project to the desired output files.
     *
     * @param project  The project whose urls should be generated.
     * @returns        A list of [[UrlMapping]] instances defining which models
     *                 should be rendered to which files.
     */
    getUrls(project:ProjectReflection):UrlMapping[] {
        var urls:UrlMapping[] = [];
        var entryPoint = this.getEntryPoint(project);

        if (this.renderer.application.options.readme == 'none') {
            entryPoint.url = 'index.html';
            urls.push(new UrlMapping('index.html', entryPoint, 'reflection.hbs'));
        } else {
            entryPoint.url = 'globals.html';
            urls.push(new UrlMapping('globals.html', entryPoint, 'reflection.hbs'));
            urls.push(new UrlMapping('index.html',   project, 'index.hbs'));
        }

        if (entryPoint.children) {
            entryPoint.children.forEach((child:Reflection) => {
                if (child instanceof DeclarationReflection) {
                    DefaultTheme.buildUrls(child, urls);
                }
            });
        }

        return urls;
    }


    /**
     * Return the entry point of the documentation.
     *
     * @param project  The current project.
     * @returns The reflection that should be used as the entry point.
     */
    getEntryPoint(project:ProjectReflection):ContainerReflection {
        var entryPoint = this.renderer.application.options.entryPoint;
        if (entryPoint) {
            var reflection = project.getChildByName(entryPoint);
            if (reflection) {
                if (reflection instanceof ContainerReflection) {
                    return reflection;
                } else {
                    this.renderer.application.logger.warn('The given entry point `%s` is not a container.', entryPoint);
                }
            } else {
                this.renderer.application.logger.warn('The entry point `%s` could not be found.', entryPoint);
            }
        }

        return project;
    }


    /**
     * Create a navigation structure for the given project.
     *
     * @param project  The project whose navigation should be generated.
     * @returns        The root navigation item.
     */
    getNavigation(project:ProjectReflection):NavigationItem {
        /**
         * Test whether the given list of modules contains an external module.
         *
         * @param modules  The list of modules to test.
         * @returns        TRUE if any of the modules is marked as being external.
         */
        function containsExternals(modules:DeclarationReflection[]):boolean {
            for (var index = 0, length = modules.length; index < length; index++) {
                if (modules[index].flags.isExternal) return true;
            }
            return false;
        }


        /**
         * Sort the given list of modules by name, groups external modules at the bottom.
         *
         * @param modules  The list of modules that should be sorted.
         */
        function sortReflections(modules:DeclarationReflection[]) {
            modules.sort((a:DeclarationReflection, b:DeclarationReflection) => {
                if (a.flags.isExternal && !b.flags.isExternal) return  1;
                if (!a.flags.isExternal && b.flags.isExternal) return -1;
                return a.getFullName() < b.getFullName() ? -1 : 1;
            });
        }


        /**
         * Find the urls of all children of the given reflection and store them as dedicated urls
         * of the given NavigationItem.
         *
         * @param reflection  The reflection whose children urls should be included.
         * @param item        The navigation node whose dedicated urls should be set.
         */
        function includeDedicatedUrls(reflection:DeclarationReflection, item:NavigationItem) {
            (function walk(reflection:DeclarationReflection) {
                for (var key in reflection.children) {
                    var child = reflection.children[key];
                    if (child.hasOwnDocument && !child.kindOf(ReflectionKind.SomeModule)) {
                        if (!item.dedicatedUrls) item.dedicatedUrls = [];
                        item.dedicatedUrls.push(child.url);
                        walk(child);
                    }
                }
            })(reflection);
        }

        /**
         * Create navigation nodes for all container children of the given reflection.
         *
         * @param reflection  The reflection whose children modules should be transformed into navigation nodes.
         * @param parent      The parent NavigationItem of the newly created nodes.
         */
        function buildChildren(reflection:DeclarationReflection, parent:NavigationItem) {
            var modules = reflection.getChildrenByKind(ReflectionKind.SomeModule);
            modules.sort((a:DeclarationReflection, b:DeclarationReflection) => {
                return a.getFullName() < b.getFullName() ? -1 : 1;
            });

            modules.forEach((reflection) => {
                var item = NavigationItem.create(reflection, parent);
                includeDedicatedUrls(reflection, item);
                buildChildren(reflection, item);
            });
        }


        /**
         * Create navigation nodes for the given list of reflections. The resulting nodes will be grouped into
         * an "internal" and an "external" section when applicable.
         *
         * @param reflections  The list of reflections which should be transformed into navigation nodes.
         * @param parent       The parent NavigationItem of the newly created nodes.
         * @param callback     Optional callback invoked for each generated node.
         */
        function buildGroups(reflections:DeclarationReflection[], parent:NavigationItem,
                             callback?:(reflection:DeclarationReflection, item:NavigationItem) => void) {
            var state = -1;
            var hasExternals = containsExternals(reflections);
            sortReflections(reflections);

            reflections.forEach((reflection) => {
                if (hasExternals && !reflection.flags.isExternal && state != 1) {
                    new NavigationItem('Internals', null, parent, "tsd-is-external");
                    state = 1;
                } else if (hasExternals && reflection.flags.isExternal && state != 2) {
                    new NavigationItem('Externals', null, parent, "tsd-is-external");
                    state = 2;
                }

                var item = NavigationItem.create(reflection, parent);
                includeDedicatedUrls(reflection, item);
                if (callback) callback(reflection, item);
            });
        }


        /**
         * Build the navigation structure.
         *
         * @param hasSeparateGlobals  Has the project a separated globals.html file?
         * @return                    The root node of the generated navigation structure.
         */
        function build(hasSeparateGlobals:boolean):NavigationItem {
            var root = new NavigationItem('Index', 'index.html');

            if (entryPoint == project) {
                var globals = new NavigationItem('Globals', hasSeparateGlobals ? 'globals.html' : 'index.html', root);
                globals.isGlobals = true;
            }

            var modules:DeclarationReflection[] = [];
            project.getReflectionsByKind(ReflectionKind.SomeModule).forEach((someModule) => {
                var target = someModule.parent;
                var inScope = (someModule == entryPoint);
                while (target) {
                    if (target.kindOf(ReflectionKind.ExternalModule)) return;
                    if (entryPoint == target) inScope = true;
                    target = target.parent;
                }

                if (inScope && someModule instanceof DeclarationReflection) {
                    modules.push(someModule);
                }
            });

            if (modules.length < 10) {
                buildGroups(modules, root);
            } else {
                buildGroups(entryPoint.getChildrenByKind(ReflectionKind.SomeModule), root, buildChildren);
            }

            return root;
        }

        var entryPoint = this.getEntryPoint(project);
        return build(this.renderer.application.options.readme != 'none');
    }


    /**
     * Triggered before the renderer starts rendering a project.
     *
     * @param event  An event object describing the current render operation.
     */
    private onRendererBegin(event:OutputEvent) {
        if (event.project.groups) {
            event.project.groups.forEach(DefaultTheme.applyGroupClasses);
        }

        for (var id in event.project.reflections) {
            var reflection = event.project.reflections[id];
            if (reflection instanceof DeclarationReflection) {
                DefaultTheme.applyReflectionClasses(<DeclarationReflection>reflection);
            }

            if (reflection instanceof ContainerReflection && reflection['groups']) {
                reflection['groups'].forEach(DefaultTheme.applyGroupClasses);
            }
        }
    }


    /**
     * Return a url for the given reflection.
     *
     * @param reflection  The reflection the url should be generated for.
     * @param relative    The parent reflection the url generation should stop on.
     * @param separator   The separator used to generate the url.
     * @returns           The generated url.
     */
    static getUrl(reflection:Reflection, relative?:Reflection, separator:string = '.'):string {
        var url = reflection.getAlias();

        if (reflection.parent && reflection.parent != relative &&
            !(reflection.parent instanceof ProjectReflection))
            url = DefaultTheme.getUrl(reflection.parent, relative, separator) + separator + url;

        return url;
    }


    /**
     * Return the template mapping fore the given reflection.
     *
     * @param reflection  The reflection whose mapping should be resolved.
     * @returns           The found mapping or NULL if no mapping could be found.
     */
    static getMapping(reflection:DeclarationReflection):ITemplateMapping {
        for (var i = 0, c = DefaultTheme.MAPPINGS.length; i < c; i++) {
            var mapping = DefaultTheme.MAPPINGS[i];
            if (reflection.kindOf(mapping.kind)) {
                return mapping;
            }
        }

        return null;
    }


    /**
     * Build the url for the the given reflection and all of its children.
     *
     * @param reflection  The reflection the url should be created for.
     * @param urls        The array the url should be appended to.
     * @returns           The altered urls array.
     */
    static buildUrls(reflection:DeclarationReflection, urls:UrlMapping[]):UrlMapping[] {
        var mapping = DefaultTheme.getMapping(reflection);
        if (mapping) {
            var url = Path.join(mapping.directory, DefaultTheme.getUrl(reflection) + '.html');
            urls.push(new UrlMapping(url, reflection, mapping.template));

            reflection.url = url;
            reflection.hasOwnDocument = true;
            for (var key in reflection.children) {
                var child = reflection.children[key];
                if (mapping.isLeaf) {
                    DefaultTheme.applyAnchorUrl(child, reflection);
                } else {
                    DefaultTheme.buildUrls(child, urls);
                }
            }
        } else {
            DefaultTheme.applyAnchorUrl(reflection, reflection.parent);
        }

        return urls;
    }


    /**
     * Generate an anchor url for the given reflection and all of its children.
     *
     * @param reflection  The reflection an anchor url should be created for.
     * @param container   The nearest reflection having an own document.
     */
    static applyAnchorUrl(reflection:Reflection, container:Reflection) {
        var anchor = DefaultTheme.getUrl(reflection, container, '.');
        if (reflection['isStatic']) {
            anchor = 'static-' + anchor;
        }

        reflection.url = container.url + '#' + anchor;
        reflection.anchor = anchor;
        reflection.hasOwnDocument = false;

        reflection.traverse((child) => {
            if (child instanceof DeclarationReflection) {
                DefaultTheme.applyAnchorUrl(child, container);
            }
        });
    }


    /**
     * Generate the css classes for the given reflection and apply them to the
     * [[DeclarationReflection.cssClasses]] property.
     *
     * @param reflection  The reflection whose cssClasses property should be generated.
     */
    static applyReflectionClasses(reflection:DeclarationReflection) {
        var classes:string[] = [];

        if (reflection.kind == ReflectionKind.Accessor) {
            if (!reflection.getSignature) {
                classes.push('tsd-kind-set-signature');
            } else if (!reflection.setSignature) {
                classes.push('tsd-kind-get-signature');
            } else {
                classes.push('tsd-kind-accessor');
            }
        } else {
            var kind = ReflectionKind[reflection.kind];
            classes.push(DefaultTheme.toStyleClass('tsd-kind-' + kind));
        }

        if (reflection.parent && reflection.parent instanceof DeclarationReflection) {
            kind = ReflectionKind[reflection.parent.kind];
            classes.push(DefaultTheme.toStyleClass('tsd-parent-kind-'+ kind));
        }

        var hasTypeParameters = !!reflection.typeParameters;
        reflection.getAllSignatures().forEach((signature) => {
            hasTypeParameters = hasTypeParameters || !!signature.typeParameters;
        });

        if (hasTypeParameters)            classes.push('tsd-has-type-parameter');
        if (reflection.overwrites)        classes.push('tsd-is-overwrite');
        if (reflection.inheritedFrom)     classes.push('tsd-is-inherited');
        if (reflection.flags.isPrivate)   classes.push('tsd-is-private');
        if (reflection.flags.isProtected) classes.push('tsd-is-protected');
        if (reflection.flags.isStatic)    classes.push('tsd-is-static');
        if (reflection.flags.isExternal)  classes.push('tsd-is-external');
        if (!reflection.flags.isExported) classes.push('tsd-is-not-exported');

        reflection.cssClasses = classes.join(' ');
    }


    /**
     * Generate the css classes for the given reflection group and apply them to the
     * [[ReflectionGroup.cssClasses]] property.
     *
     * @param group  The reflection group whose cssClasses property should be generated.
     */
    static applyGroupClasses(group:ReflectionGroup) {
        var classes:string[] = [];
        if (group.allChildrenAreInherited)  classes.push('tsd-is-inherited');
        if (group.allChildrenArePrivate)    classes.push('tsd-is-private');
        if (group.allChildrenAreProtectedOrPrivate) classes.push('tsd-is-private-protected');
        if (group.allChildrenAreExternal)   classes.push('tsd-is-external');
        if (!group.someChildrenAreExported) classes.push('tsd-is-not-exported');

        group.cssClasses = classes.join(' ');
    }


    /**
     * Transform a space separated string into a string suitable to be used as a
     * css class, e.g. "constructor method" > "Constructor-method".
     */
    static toStyleClass(str:string) {
        return str.replace(/(\w)([A-Z])/g, (m, m1, m2) => m1 + '-' + m2).toLowerCase();
    }
}
