import * as _ from 'lodash-es';
import * as PropTypes from 'prop-types';
import * as React from 'react';
import { connect } from 'react-redux';
import { withTranslation } from 'react-i18next';
import {
  getNodeRoles,
  getMachinePhase,
  nodeMemory,
  nodeCPU,
  nodeFS,
  nodePods,
  nodeMachine,
  nodeInstanceType,
  nodeZone,
  pvcUsed,
  snapshotSize,
  snapshotSource,
  ALL_NAMESPACES_KEY,
  getName,
} from '@console/shared';
import * as UIActions from '../../actions/ui';
import {
  alertingRuleSource,
  alertingRuleStateOrder,
  alertSeverityOrder,
  alertSource,
  alertStateOrder,
  silenceFiringAlertsOrder,
  silenceStateOrder,
} from '../monitoring/utils';
import { ingressValidHosts } from '../ingress';
import { convertToBaseValue, EmptyBox, StatusBox, WithScrollContainer } from '../utils';
import {
  CustomResourceDefinitionKind,
  getClusterOperatorStatus,
  getClusterOperatorVersion,
  getJobTypeAndCompletions,
  getLatestVersionForCRD,
  getTemplateInstanceStatus,
  K8sResourceKind,
  K8sResourceKindReference,
  NodeKind,
  planExternalName,
  PodKind,
  podPhase,
  podReadiness,
  podRestarts,
  serviceCatalogStatus,
  serviceClassDisplayName,
  MachineKind,
  VolumeSnapshotKind,
} from '../../module/k8s';

import {
  IRowData, // eslint-disable-line no-unused-vars
  IExtraData, // eslint-disable-line no-unused-vars
  Table as PfTable,
  TableHeader,
  TableBody,
  TableGridBreakpoint,
  SortByDirection,
  OnSelect,
} from '@patternfly/react-table';

import { CellMeasurerCache, CellMeasurer } from 'react-virtualized';

import {
  AutoSizer,
  VirtualTableBody,
  WindowScroller,
} from '@patternfly/react-virtualized-extension';

import { tableFilters } from './table-filters';
import { PackageManifestKind } from '@console/operator-lifecycle-manager/src/types';
import { defaultChannelFor } from '@console/operator-lifecycle-manager/src/components';

const rowFiltersToFilterFuncs = (rowFilters) => {
  return (rowFilters || [])
    .filter((f) => f.type && _.isFunction(f.filter))
    .reduce((acc, f) => ({ ...acc, [f.type]: f.filter }), {});
};

const getAllTableFilters = (rowFilters) => ({
  ...tableFilters,
  ...rowFiltersToFilterFuncs(rowFilters),
});

export const getFilteredRows = (_filters, rowFilters, objects) => {
  if (_.isEmpty(_filters)) {
    return objects;
  }

  const allTableFilters = getAllTableFilters(rowFilters);
  let filteredObjects = objects;
  _.each(_filters, (value, name) => {
    const filter = allTableFilters[name];
    if (_.isFunction(filter)) {
      filteredObjects = _.filter(filteredObjects, (o) => filter(value, o));
    }
  });

  return filteredObjects;
};

const filterPropType = (props, propName, componentName) => {
  if (!props) {
    return;
  }

  const allTableFilters = getAllTableFilters(props.rowFilters);
  for (const key of _.keys(props[propName])) {
    if (key in allTableFilters || key === 'loadTest') {
      continue;
    }
    return new Error(
      `Invalid prop '${propName}' in '${componentName}'. '${key}' is not a valid filter type!`,
    );
  }
};

const sorts = {
  alertingRuleSource,
  alertingRuleStateOrder,
  alertSeverityOrder,
  alertSource,
  alertStateOrder,
  crdLatestVersion: (crd: CustomResourceDefinitionKind): string => getLatestVersionForCRD(crd),
  daemonsetNumScheduled: (daemonset) =>
    _.toInteger(_.get(daemonset, 'status.currentNumberScheduled')),
  dataSize: (resource) => _.size(_.get(resource, 'data')) + _.size(_.get(resource, 'binaryData')),
  ingressValidHosts,
  serviceCatalogStatus,
  jobCompletionsSucceeded: (job) => job?.status?.succeeded || 0,
  jobType: (job) => getJobTypeAndCompletions(job).type,
  nodeReadiness: (node: NodeKind) => {
    let readiness = _.get(node, 'status.conditions');
    readiness = _.find(readiness, { type: 'Ready' });
    return _.get(readiness, 'status');
  },
  numReplicas: (resource) => _.toInteger(_.get(resource, 'status.replicas')),
  planExternalName,
  namespaceCPU: (ns: K8sResourceKind): number => UIActions.getNamespaceMetric(ns, 'cpu'),
  namespaceMemory: (ns: K8sResourceKind): number => UIActions.getNamespaceMetric(ns, 'memory'),
  podCPU: (pod: PodKind): number => UIActions.getPodMetric(pod, 'cpu'),
  podMemory: (pod: PodKind): number => UIActions.getPodMetric(pod, 'memory'),
  podPhase,
  podReadiness: (pod: PodKind): number => podReadiness(pod).readyCount,
  podRestarts,
  pvStorage: (pv) => _.toInteger(convertToBaseValue(pv?.spec?.capacity?.storage)),
  pvcStorage: (pvc) => _.toInteger(convertToBaseValue(pvc?.status?.capacity?.storage)),
  serviceClassDisplayName,
  silenceFiringAlertsOrder,
  silenceStateOrder,
  string: (val) => JSON.stringify(val),
  number: (val) => _.toNumber(val),
  getClusterOperatorStatus,
  getClusterOperatorVersion,
  getTemplateInstanceStatus,
  nodeRoles: (node: NodeKind): string => {
    const roles = getNodeRoles(node);
    return roles.sort().join(', ');
  },
  nodeMemory: (node: NodeKind): number => nodeMemory(node),
  nodeCPU: (node: NodeKind): number => nodeCPU(node),
  nodeFS: (node: NodeKind): number => nodeFS(node),
  nodeMachine: (node: NodeKind): string => nodeMachine(node),
  nodeInstanceType: (node: NodeKind): string => nodeInstanceType(node),
  nodeZone: (node: NodeKind): string => nodeZone(node),
  machinePhase: (machine: MachineKind): string => getMachinePhase(machine),
  nodePods: (node: NodeKind): number => nodePods(node),
  pvcUsed: (pvc: K8sResourceKind): number => pvcUsed(pvc),
  volumeSnapshotSize: (snapshot: VolumeSnapshotKind): number => snapshotSize(snapshot),
  volumeSnapshotSource: (snapshot: VolumeSnapshotKind): string => snapshotSource(snapshot),
  snapshotLastRestore: (snapshot: K8sResourceKind, { restores }) =>
    restores[getName(snapshot)]?.status?.restoreTime,
  sortPackageManifestByDefaultChannelName: (packageManifest: PackageManifestKind): string => {
    const channel = defaultChannelFor(packageManifest);
    return channel?.currentCSVDesc?.displayName;
  },
};

const stateToProps = (
  { UI },
  {
    customData = {},
    customSorts = {},
    data = [],
    defaultSortField = 'metadata.name',
    defaultSortFunc = undefined,
    defaultSortOrder = SortByDirection.asc,
    filters = {},
    loaded = false,
    reduxID = null,
    reduxIDs = null,
    staticFilters = [{}],
    rowFilters = [],
    isPinned,
  }: TableProps,
) => {
  const allFilters = staticFilters ? Object.assign({}, filters, ...staticFilters) : filters;
  const newData = getFilteredRows(allFilters, rowFilters, data);

  const listId = reduxIDs ? reduxIDs.join(',') : reduxID;
  // Only default to 'metadata.name' if no `defaultSortFunc`
  const currentSortField = UI.getIn(
    ['listSorts', listId, 'field'],
    defaultSortFunc ? undefined : defaultSortField,
  );
  const currentSortFunc = UI.getIn(['listSorts', listId, 'func'], defaultSortFunc);
  const currentSortOrder = UI.getIn(['listSorts', listId, 'orderBy'], defaultSortOrder);
  if (loaded) {
    let sortBy: string | Function = 'metadata.name';
    if (currentSortField) {
      sortBy = (resource) => sorts.string(_.get(resource, currentSortField, ''));
    } else if (currentSortFunc && customSorts[currentSortFunc]) {
      // Sort resources by a function in the 'customSorts' prop
      sortBy = customSorts[currentSortFunc];
    } else if (currentSortFunc && sorts[currentSortFunc]) {
      // Sort resources by a function in the 'sorts' object
      sortBy = sorts[currentSortFunc];
    }

    const getSortValue = (resource) => {
      const val = _.isFunction(sortBy)
        ? sortBy(resource, customData)
        : _.get(resource, sortBy as string);
      return val ?? '';
    };
    newData?.sort((a, b) => {
      const lang = navigator.languages[0] || navigator.language;
      // Use `localCompare` with `numeric: true` for a natural sort order (e.g., pv-1, pv-9, pv-10)
      const compareOpts = { numeric: true, ignorePunctuation: true };
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);
      const aPinned = isPinned?.(a);
      const bPinned = isPinned?.(b);
      if (aPinned !== bPinned) {
        return aPinned ? -1 : +1;
      }
      const result: number =
        Number.isFinite(aValue) && Number.isFinite(bValue)
          ? aValue - bValue
          : `${aValue}`.localeCompare(`${bValue}`, lang, compareOpts);
      if (result !== 0) {
        return currentSortOrder === SortByDirection.asc ? result : result * -1;
      }

      // Use name as a secondary sort for a stable sort.
      const aName = a?.metadata?.name || '';
      const bName = b?.metadata?.name || '';
      return aName.localeCompare(bName, lang, compareOpts);
    });
  }

  return {
    currentSortField,
    currentSortFunc,
    currentSortOrder,
    data: newData,
    unfilteredData: data,
    listId,
  };
};

// Common table row/columns helper SFCs for implementing accessible data grid
export const TableRow: React.SFC<TableRowProps> = ({
  id,
  index,
  trKey,
  style,
  className,
  ...props
}) => {
  return (
    <tr
      {...props}
      data-id={id}
      data-index={index}
      data-test-rows="resource-row"
      data-key={trKey}
      style={style}
      className={className}
      role="row"
    />
  );
};
TableRow.displayName = 'TableRow';
export type TableRowProps = {
  id: any;
  index: number;
  title?: string;
  trKey: string;
  style: object;
  className?: string;
};

const BREAKPOINT_SM = 576;
const BREAKPOINT_MD = 768;
const BREAKPOINT_LG = 992;
const BREAKPOINT_XL = 1200;
const BREAKPOINT_XXL = 1400;
const MAX_COL_XS = 2;
const MAX_COL_SM = 4;
const MAX_COL_MD = 4;
const MAX_COL_LG = 6;
const MAX_COL_XL = 8;

const isColumnVisible = (
  columnID: string,
  columns: Set<string> = new Set(),
  showNamespaceOverride,
) => {
  const showNamespace =
    columnID !== 'namespace' ||
    UIActions.getActiveNamespace() === ALL_NAMESPACES_KEY ||
    showNamespaceOverride;
  if (_.isEmpty(columns) && showNamespace) {
    return true;
  }
  if (!columns.has(columnID) || !showNamespace) {
    return false;
  }
  const widthInPixels = window.innerWidth;
  const columnIndex = [...columns].indexOf(columnID);
  if (widthInPixels < BREAKPOINT_SM) {
    return columnIndex < MAX_COL_XS;
  }
  if (widthInPixels < BREAKPOINT_MD) {
    return columnIndex < MAX_COL_SM;
  }
  if (widthInPixels < BREAKPOINT_LG) {
    return columnIndex < MAX_COL_MD;
  }
  if (widthInPixels < BREAKPOINT_XL) {
    return columnIndex < MAX_COL_LG;
  }
  if (widthInPixels < BREAKPOINT_XXL) {
    return columnIndex < MAX_COL_XL;
  }
  return true;
};

export const TableData: React.SFC<TableDataProps> = ({
  className,
  columnID,
  columns,
  showNamespaceOverride,
  ...props
}) => {
  return isColumnVisible(columnID, columns, showNamespaceOverride) ? (
    <td {...props} className={className} role="gridcell" />
  ) : null;
};
TableData.displayName = 'TableData';
export type TableDataProps = {
  className?: string;
  columnID?: string;
  columns?: Set<string>;
  id?: string;
  showNamespaceOverride?: boolean;
};

const TableWrapper: React.SFC<TableWrapperProps> = ({
  virtualize,
  ariaLabel,
  ariaRowCount,
  ...props
}) => {
  return virtualize ? (
    <div {...props} role="grid" aria-label={ariaLabel} aria-rowcount={ariaRowCount} />
  ) : (
    <React.Fragment {...props} />
  );
};
export type TableWrapperProps = {
  virtualize: boolean;
  ariaLabel: string;
  ariaRowCount: number | undefined;
};

const VirtualBody: React.SFC<VirtualBodyProps> = (props) => {
  const {
    customData,
    Row,
    height,
    isScrolling,
    onChildScroll,
    data,
    columns,
    scrollTop,
    width,
  } = props;

  const cellMeasurementCache = new CellMeasurerCache({
    fixedWidth: true,
    minHeight: 44,
    keyMapper: (rowIndex) => _.get(props.data[rowIndex], 'metadata.uid', rowIndex),
  });

  const rowRenderer = ({ index, isScrolling: scrolling, isVisible, key, style, parent }) => {
    const rowArgs = {
      obj: data[index],
      index,
      columns,
      isScrolling: scrolling,
      key,
      style,
      customData,
    };

    const row = Row(rowArgs);

    // do not render non visible elements (this excludes overscan)
    if (!isVisible) {
      return null;
    }
    return (
      <CellMeasurer
        cache={cellMeasurementCache}
        columnIndex={0}
        key={key}
        parent={parent}
        rowIndex={index}
      >
        {row}
      </CellMeasurer>
    );
  };

  return (
    <VirtualTableBody
      autoHeight
      className="pf-c-table pf-m-compact pf-m-border-rows pf-c-virtualized pf-c-window-scroller"
      deferredMeasurementCache={cellMeasurementCache}
      rowHeight={cellMeasurementCache.rowHeight}
      height={height || 0}
      isScrolling={isScrolling}
      onScroll={onChildScroll}
      overscanRowCount={10}
      columns={columns}
      rows={data}
      rowCount={data.length}
      rowRenderer={rowRenderer}
      scrollTop={scrollTop}
      width={width}
    />
  );
};

export type RowFunctionArgs<T = any, C = any> = {
  obj: T;
  index: number;
  columns: any[];
  isScrolling: boolean;
  key: string;
  style: object;
  customData?: C;
};

export type RowFunction<T = any, C = any> = (args: RowFunctionArgs<T, C>) => React.ReactElement;

export type VirtualBodyProps = {
  customData?: any;
  Row: RowFunction;
  height: number;
  isScrolling: boolean;
  onChildScroll: (...args) => any;
  data: any[];
  columns: any[];
  scrollTop: number;
  width: number;
  expand: boolean;
};

export type TableProps = {
  customData?: any;
  customSorts?: { [key: string]: any };
  data?: any[];
  defaultSortFunc?: string;
  defaultSortField?: string;
  defaultSortOrder?: SortByDirection;
  showNamespaceOverride?: boolean;
  filters?: { [key: string]: any };
  Header: (...args) => any[];
  loadError?: string | Object;
  Row?: RowFunction;
  Rows?: (...args) => any[];
  'aria-label': string;
  onSelect?: OnSelect;
  virtualize?: boolean;
  NoDataEmptyMsg?: React.ComponentType<{}>;
  EmptyMsg?: React.ComponentType<{}>;
  loaded?: boolean;
  reduxID?: string;
  reduxIDs?: string[];
  rowFilters?: any[];
  label?: string;
  columnManagementID?: string;
  isPinned?: (val: any) => boolean;
  staticFilters?: any[];
  activeColumns?: Set<string>;
  kinds?: string[];
};

type TablePropsFromState = {};

type TablePropsFromDispatch = {};

type TableOptionProps = {
  UI: any;
};

type ComponentProps = {
  data?: any[];
  filters?: Object;
  selected?: any;
  match?: any;
  kindObj?: K8sResourceKindReference;
};

const getActiveColumns = (
  Header: any,
  componentProps: ComponentProps,
  activeColumns: Set<string>,
  columnManagementID: string,
  showNamespaceOverride: boolean,
) => {
  let columns = Header(componentProps);
  if (_.isEmpty(activeColumns)) {
    activeColumns = new Set(
      columns.map((col) => {
        if (col.id && !col.additional) {
          return col.id;
        }
      }),
    );
  }
  if (columnManagementID) {
    columns = columns?.filter(
      (col) => isColumnVisible(col.id, activeColumns, showNamespaceOverride) || col.title === '',
    );
  } else {
    columns = columns?.filter((col) => activeColumns.has(col.id) || col.title === '');
  }

  const showNamespace =
    UIActions.getActiveNamespace() === ALL_NAMESPACES_KEY || showNamespaceOverride;
  if (!showNamespace) {
    columns = columns.filter((column) => column.id !== 'namespace');
  }
  return columns;
};

export const Table = connect<
  TablePropsFromState,
  TablePropsFromDispatch,
  TableProps,
  TableOptionProps
>(stateToProps, { sortList: UIActions.sortList }, null, {
  areStatesEqual: ({ UI: next }, { UI: prev }) => next.get('listSorts') === prev.get('listSorts'),
})(
  withTranslation()(
    class TableInner extends React.Component<TableInnerProps, TableInnerState> {
      static propTypes = {
        customData: PropTypes.any,
        data: PropTypes.array,
        showNamespaceOverride: PropTypes.bool,
        unfilteredData: PropTypes.array,
        NoDataEmptyMsg: PropTypes.func,
        EmptyMsg: PropTypes.func,
        expand: PropTypes.bool,
        fieldSelector: PropTypes.string,
        filters: filterPropType,
        Header: PropTypes.func.isRequired,
        Row: PropTypes.func,
        Rows: PropTypes.func,
        loaded: PropTypes.bool,
        loadError: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
        mock: PropTypes.bool,
        namespace: PropTypes.string,
        reduxID: PropTypes.string,
        reduxIDs: PropTypes.array,
        selector: PropTypes.object,
        staticFilters: PropTypes.array,
        virtualize: PropTypes.bool,
        currentSortField: PropTypes.string,
        currentSortFunc: PropTypes.string,
        currentSortOrder: PropTypes.any,
        defaultSortField: PropTypes.string,
        defaultSortFunc: PropTypes.string,
        label: PropTypes.string,
        listId: PropTypes.string,
        sortList: PropTypes.func,
        onSelect: PropTypes.func,
        scrollElement: PropTypes.oneOf([PropTypes.object, PropTypes.func]),
        columnManagementID: PropTypes.string, // for column management should use gvk for workloads
      };
      _columnShift: number;

      constructor(props) {
        super(props);
        const componentProps: ComponentProps = _.pick(props, [
          'data',
          'filters',
          'selected',
          'match',
          'kindObj',
        ]);
        const columns = getActiveColumns(
          this.props.Header,
          componentProps,
          this.props.activeColumns,
          this.props.columnManagementID,
          this.props.showNamespaceOverride,
        );
        const { currentSortField, currentSortFunc, currentSortOrder } = props;

        this._columnShift = props.onSelect ? 1 : 0; //shift indexes by 1 if select provided
        this._applySort = this._applySort.bind(this);
        this._onSort = this._onSort.bind(this);
        this._handleResize = _.debounce(this._handleResize.bind(this), 100);

        let sortBy = {};
        if (currentSortField && currentSortOrder) {
          const columnIndex = _.findIndex(columns, { sortField: currentSortField });
          if (columnIndex > -1) {
            sortBy = { index: columnIndex + this._columnShift, direction: currentSortOrder };
          }
        } else if (currentSortFunc && currentSortOrder) {
          const columnIndex = _.findIndex(columns, { sortFunc: currentSortFunc });
          if (columnIndex > -1) {
            sortBy = { index: columnIndex + this._columnShift, direction: currentSortOrder };
          }
        }
        this.state = { sortBy, columns };
        props.i18n.on('languageChanged', () => {
          this.setState({
            columns: props.Header(componentProps, props.t),
          });
        });
      }

      componentDidMount() {
        const componentProps: ComponentProps = _.pick(this.props, [
          'data',
          'filters',
          'selected',
          'match',
          'kindObj',
        ]);
        const columns = getActiveColumns(
          this.props.Header,
          componentProps,
          this.props.activeColumns,
          this.props.columnManagementID,
          this.props.showNamespaceOverride,
        );
        const sp = new URLSearchParams(window.location.search);
        const columnIndex = _.findIndex(columns, { title: sp.get('sortBy') });

        if (columnIndex > -1) {
          const sortOrder = sp.get('orderBy') || SortByDirection.asc;
          const column = columns[columnIndex];
          this._applySort(column.sortField, column.sortFunc, sortOrder, column.title);
          this.setState({
            sortBy: {
              index: columnIndex + this._columnShift,
              direction: sortOrder,
            },
          });
        }

        // re-render after resize
        window.addEventListener('resize', this._handleResize);
      }

      componentWillUnmount() {
        window.removeEventListener('resize', this._handleResize);
      }

      _handleResize() {
        this.forceUpdate();
      }

      _applySort(sortField, sortFunc, direction, columnTitle) {
        const { sortList, listId, currentSortFunc } = this.props;
        const applySort = _.partial(sortList, listId);
        applySort(sortField, sortFunc || currentSortFunc, direction, columnTitle);
      }

      _onSort(event, index, direction) {
        event.preventDefault();
        const componentProps: ComponentProps = _.pick(this.props, [
          'data',
          'filters',
          'selected',
          'match',
          'kindObj',
        ]);
        const columns = getActiveColumns(
          this.props.Header,
          componentProps,
          this.props.activeColumns,
          this.props.columnManagementID,
          this.props.showNamespaceOverride,
        );
        const sortColumn = columns[index - this._columnShift];
        this._applySort(sortColumn.sortField, sortColumn.sortFunc, direction, sortColumn.title);
        this.setState({
          sortBy: {
            index,
            direction,
          },
        });
      }

      render() {
        const {
          columnManagementID,
          scrollElement,
          Rows,
          Row,
          expand,
          label,
          mock,
          onSelect,
          selectedResourcesForKind,
          'aria-label': ariaLabel,
          virtualize = true,
          customData,
          gridBreakPoint = TableGridBreakpoint.none,
          Header,
          activeColumns,
          showNamespaceOverride,
        } = this.props;
        const { sortBy } = this.state;
        const componentProps: any = _.pick(this.props, [
          'data',
          'filters',
          'selected',
          'match',
          'kindObj',
        ]);
        const columns = getActiveColumns(
          Header,
          componentProps,
          activeColumns,
          columnManagementID,
          showNamespaceOverride,
        );
        const ariaRowCount = componentProps.data && componentProps.data.length;
        const scrollNode = typeof scrollElement === 'function' ? scrollElement() : scrollElement;
        const renderVirtualizedTable = (scrollContainer) => (
          <WindowScroller scrollElement={scrollContainer}>
            {({ height, isScrolling, registerChild, onChildScroll, scrollTop }) => (
              <AutoSizer disableHeight>
                {({ width }) => (
                  <div ref={registerChild}>
                    <VirtualBody
                      Row={Row}
                      customData={customData}
                      height={height}
                      isScrolling={isScrolling}
                      onChildScroll={onChildScroll}
                      data={componentProps.data}
                      columns={columns}
                      scrollTop={scrollTop}
                      width={width}
                      expand={expand}
                    />
                  </div>
                )}
              </AutoSizer>
            )}
          </WindowScroller>
        );
        const children = mock ? (
          <EmptyBox label={label} />
        ) : (
          <TableWrapper virtualize={virtualize} ariaLabel={ariaLabel} ariaRowCount={ariaRowCount}>
            <PfTable
              cells={columns}
              rows={
                virtualize ? [] : Rows({ componentProps, selectedResourcesForKind, customData })
              }
              gridBreakPoint={gridBreakPoint}
              onSort={this._onSort}
              onSelect={onSelect}
              sortBy={sortBy}
              className="pf-m-compact pf-m-border-rows"
              role={virtualize ? 'presentation' : 'grid'}
              aria-label={virtualize ? null : ariaLabel}
            >
              <TableHeader />
              {!virtualize && <TableBody />}
            </PfTable>
            {virtualize &&
              (scrollNode ? (
                renderVirtualizedTable(scrollNode)
              ) : (
                <WithScrollContainer>{renderVirtualizedTable}</WithScrollContainer>
              ))}
          </TableWrapper>
        );
        return (
          <div className="co-m-table-grid co-m-table-grid--bordered">
            {mock ? (
              children
            ) : (
              <StatusBox skeleton={<div className="loading-skeleton--table" />} {...this.props}>
                {children}
              </StatusBox>
            )}
          </div>
        );
      }
    },
  ),
);

export type TableInnerProps = {
  'aria-label': string;
  customData?: any;
  currentSortField?: string;
  currentSortFunc?: string;
  currentSortOrder?: any;
  data?: any[];
  defaultSortField?: string;
  defaultSortFunc?: string;
  showNamespaceOverride?: boolean;
  activeColumns?: Set<string>;
  unfilteredData?: any[];
  NoDataEmptyMsg?: React.ComponentType<{}>;
  EmptyMsg?: React.ComponentType<{}>;
  expand?: boolean;
  fieldSelector?: string;
  filters?: { [name: string]: any };
  Header: (...args) => any[];
  label?: string;
  listId?: string;
  loaded?: boolean;
  loadError?: string | Object;
  mock?: boolean;
  namespace?: string;
  reduxID?: string;
  reduxIDs?: string[];
  Row?: RowFunction;
  Rows?: (...args) => any[];
  selector?: Object;
  sortList?: (listId: string, field: string, func: any, orderBy: string, column: string) => any;
  selectedResourcesForKind?: string[];
  onSelect?: (
    event: React.FormEvent<HTMLInputElement>,
    isSelected: boolean,
    rowIndex: number,
    rowData: IRowData,
    extraData: IExtraData,
  ) => void;
  staticFilters?: any[];
  rowFilters?: any[];
  virtualize?: boolean;
  gridBreakPoint?: 'grid' | 'grid-md' | 'grid-lg' | 'grid-xl' | 'grid-2xl';
  scrollElement?: HTMLElement | (() => HTMLElement);
  columnManagementID?: string;
};

export type TableInnerState = {
  sortBy: object;
  columns?: any;
};